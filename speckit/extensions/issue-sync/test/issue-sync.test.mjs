import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cacheDir,
  Failure,
  isSafePath,
  issueFromBranch,
  parseComment,
  planPush,
  renderComment,
} from '../scripts/issue-sync.mjs'

test('the issue number is read from a <type>/<number>-<slug> branch', () => {
  assert.equal(issueFromBranch('feat/189-freeze-behaviour'), 189)
  assert.equal(issueFromBranch('chore/7-x'), 7)
  assert.equal(issueFromBranch('main'), null)
  assert.equal(issueFromBranch('189-no-type'), null)
  assert.equal(issueFromBranch('feat/no-number'), null)
})

test('the cache of an issue lives under the ignored temporary root', () => {
  assert.equal(cacheDir(189), '.specify/tmp/issue-189')
})

test('only plain relative paths are accepted from a comment', () => {
  for (const path of ['spec.md', 'contracts/api.yaml', 'assess/research.md', 'checklists/ux-1.md']) {
    assert.equal(isSafePath(path), true, path)
  }
  for (const path of [
    '',
    '/etc/passwd',
    '../x.md',
    'a/../../x.md',
    './spec.md',
    'a//b.md',
    'a\\b.md',
    'a b.md',
  ]) {
    assert.equal(isSafePath(path), false, path)
  }
})

test('a rendered artifact parses back to its path and exact content', () => {
  const content = '# Spec\n\nLine\n\n```md\n<!-- speckit-artifact: x.md -->\n```\n'
  assert.deepEqual(parseComment(renderComment('spec.md', content)), { path: 'spec.md', content })
})

test('a comment GitHub returns with CRLF line endings parses the same', () => {
  const body = renderComment('plan.md', 'a\nb\n').replace(/\n/g, '\r\n')
  assert.deepEqual(parseComment(body), { path: 'plan.md', content: 'a\nb\n' })
})

test('a comment without the marker on its first line is not an artifact', () => {
  assert.equal(parseComment('Plain discussion'), null)
  assert.equal(parseComment(`Quote:\n${renderComment('spec.md', 'x')}`), null)
})

test('a marker naming an unsafe path is not an artifact', () => {
  assert.equal(parseComment('<!-- speckit-artifact: ../../.bashrc -->\n## x\n\nevil'), null)
})

test('a push creates the new, updates the changed and leaves the unchanged', () => {
  const comments = [
    { id: 1, body: 'A discussion comment' },
    { id: 2, body: renderComment('spec.md', 'same') },
    { id: 3, body: renderComment('plan.md', 'old') },
    { id: 4, body: renderComment('research.md', 'only remote') },
  ]
  const files = [
    { path: 'spec.md', content: 'same' },
    { path: 'plan.md', content: 'new' },
    { path: 'tasks.md', content: 'fresh' },
  ]
  assert.deepEqual(
    planPush(files, comments).map(({ kind, path, id }) => ({ kind, path, id })),
    [
      { kind: 'update', path: 'plan.md', id: 3 },
      { kind: 'create', path: 'tasks.md', id: undefined },
    ],
  )
})

test('an unchanged artifact returned with CRLF line endings is not updated', () => {
  const comments = [{ id: 1, body: renderComment('spec.md', 'a\nb').replace(/\n/g, '\r\n') }]
  assert.deepEqual(planPush([{ path: 'spec.md', content: 'a\nb' }], comments), [])
})

test('an artifact over the GitHub comment limit is refused before anything is sent', () => {
  const files = [{ path: 'spec.md', content: 'x'.repeat(65536) }]
  assert.throws(
    () => planPush(files, []),
    (error) => error instanceof Failure && /spec\.md.*split it/.test(error.message),
  )
})
