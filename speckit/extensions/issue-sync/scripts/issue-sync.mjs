#!/usr/bin/env node
// Keeps the Spec Kit artifacts of a feature in its GitHub issue, one comment
// per artifact updated in place, and a local copy in a git-ignored cache that
// the Spec Kit commands read and write. The issue is the source: the cache is
// rebuilt from it before every step, and nothing in it is ever committed.
//
// Usage:
//   node issue-sync.mjs pull [<issue>] [--dir <dir>] [--prefix <prefix>]
//   node issue-sync.mjs push [<issue>] [--dir <dir>] [--prefix <prefix>] [--note <text>]
//
// Without <issue>, the number is read from the branch (`<type>/<number>-<slug>`).
// Without --dir, the cache of that issue is used, and pull points Spec Kit's
// .specify/feature.json at it. --prefix namespaces what another flow writes
// elsewhere (`assess/`, `bug/`) so that its files never collide with the
// feature's own: push names each comment <prefix><path>, pull only restores
// the comments under that prefix.
//
// Requires an authenticated `gh`, run from inside the repository.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CACHE_ROOT = '.specify/tmp'
const CONTEXT_FILE = 'issue.md'
const MARKER = /^<!-- speckit-artifact: (\S+) -->$/
// GitHub refuses a comment body over 65536 characters.
const MAX_BODY = 65536
const TEXT_FILE = /\.(md|json|ya?ml|txt)$/

export class Failure extends Error {}

export function cacheDir(issue) {
  return `${CACHE_ROOT}/issue-${issue}`
}

export function issueFromBranch(branch) {
  const match = /^[a-z]+\/(\d+)-/.exec(branch)
  return match ? Number(match[1]) : null
}

// Artifact paths come from comments anyone can write: only plain relative
// paths are accepted, so that a pull never writes outside its directory.
export function isSafePath(path) {
  return (
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) &&
    !path.split('/').some((part) => part === '.' || part === '..')
  )
}

export function renderComment(path, content) {
  return `<!-- speckit-artifact: ${path} -->\n## Spec Kit · \`${path}\`\n\n${content}`
}

// Returns { path, content } for an artifact comment, null for any other.
export function parseComment(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const match = MARKER.exec(lines[0] ?? '')
  if (!match || !isSafePath(match[1])) return null
  return { path: match[1], content: lines.slice(3).join('\n') }
}

// Decides what a push does: each local file is created, updated or left as it
// is. A comment whose file is gone stays: the cache is never the source.
export function planPush(files, comments) {
  const existing = new Map()
  for (const comment of comments) {
    const artifact = parseComment(comment.body)
    if (artifact) existing.set(artifact.path, { id: comment.id, body: comment.body })
  }
  const actions = []
  for (const { path, content } of files) {
    const body = renderComment(path, content)
    if (body.length > MAX_BODY) {
      throw new Failure(`${path} is ${body.length} characters, over GitHub's ${MAX_BODY}: split it.`)
    }
    const current = existing.get(path)
    if (!current) actions.push({ kind: 'create', path, body })
    else if (current.body.replace(/\r\n/g, '\n') !== body) {
      actions.push({ kind: 'update', path, body, id: current.id })
    }
  }
  return actions
}

function run(command, args, input) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Failure(`${command} ${args.join(' ')} failed: ${error.stderr || error.message}`)
  }
}

function gh(args, input) {
  return run('gh', args, input)
}

function comments(issue) {
  // --slurp gathers every page into one array of pages.
  const pages = JSON.parse(
    gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/issues/${issue}/comments`]),
  )
  return pages.flat().map(({ id, body }) => ({ id, body }))
}

function listFiles(dir, prefix) {
  const result = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (TEXT_FILE.test(entry.name)) {
        const path = relative(dir, full).split(sep).join('/')
        if (path !== CONTEXT_FILE) result.push({ path: prefix + path, content: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(dir)
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, issue: null, dir: null, prefix: '', note: null }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--dir' || arg === '--prefix' || arg === '--note') {
      if (i + 1 >= rest.length) throw new Failure(`${arg} needs a value.`)
      options[arg.slice(2)] = rest[++i]
    } else if (/^\d+$/.test(arg) && options.issue === null) options.issue = Number(arg)
    else throw new Failure(`unexpected argument: ${arg}`)
  }
  if (options.prefix && !(options.prefix.endsWith('/') && isSafePath(options.prefix.slice(0, -1)))) {
    throw new Failure('--prefix is a plain relative directory ending with "/", such as "assess/".')
  }
  return options
}

function resolveIssue(options) {
  if (options.issue !== null) return options.issue
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const issue = issueFromBranch(branch)
  if (issue === null) {
    throw new Failure(`branch "${branch}" names no issue (<type>/<number>-<slug>): pass the issue number.`)
  }
  return issue
}

function pull(options) {
  const issue = resolveIssue(options)
  const dir = options.dir ?? cacheDir(issue)
  mkdirSync(dir, { recursive: true })
  const restored = []
  if (!options.dir) {
    const meta = JSON.parse(gh(['issue', 'view', String(issue), '--json', 'title,body,url,state']))
    const context = `# ${meta.title}\n\n${meta.url} (${meta.state})\n\n${meta.body}\n`
    writeFileSync(join(dir, CONTEXT_FILE), context)
    writeFileSync('.specify/feature.json', `${JSON.stringify({ feature_directory: dir }, null, 2)}\n`)
  }
  for (const comment of comments(issue)) {
    const artifact = parseComment(comment.body)
    if (!artifact?.path.startsWith(options.prefix)) continue
    const target = join(dir, artifact.path.slice(options.prefix.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, artifact.content)
    restored.push(artifact.path)
  }
  return { issue, dir, restored }
}

function push(options) {
  const issue = resolveIssue(options)
  const dir = options.dir ?? cacheDir(issue)
  const actions = planPush(listFiles(dir, options.prefix), comments(issue))
  for (const action of actions) {
    const payload = JSON.stringify({ body: action.body })
    if (action.kind === 'create') {
      gh(
        ['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${issue}/comments`, '--input', '-'],
        payload,
      )
    } else {
      gh(
        ['api', '--method', 'PATCH', `repos/{owner}/{repo}/issues/comments/${action.id}`, '--input', '-'],
        payload,
      )
    }
  }
  const changed = actions.map((action) => action.path)
  if (changed.length > 0 && options.note) {
    const list = changed.map((path) => `\`${path}\``).join(', ')
    const body = `Spec Kit : ${options.note}\n\nArtefacts mis à jour : ${list}.`
    gh(
      ['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${issue}/comments`, '--input', '-'],
      JSON.stringify({ body }),
    )
  }
  return { issue, dir, created: actions.filter((a) => a.kind === 'create').map((a) => a.path), changed }
}

function main(argv) {
  const options = parseArgs(argv)
  if (options.command === 'pull') return pull(options)
  if (options.command === 'push') return push(options)
  throw new Failure(
    'usage: issue-sync.mjs pull|push [<issue>] [--dir <dir>] [--prefix <prefix>] [--note <text>]',
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2)), null, 2))
  } catch (error) {
    if (!(error instanceof Failure)) throw error
    console.error(`issue-sync: ${error.message}`)
    process.exit(1)
  }
}
