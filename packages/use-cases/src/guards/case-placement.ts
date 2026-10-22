import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * A use case is declared under cases/ and nowhere else, and knows no interface:
 * a case in a driver would be played by the interface it should test, and a
 * case importing a driver or an interface's code would test that code instead
 * of what a person does. Refused with case_outside_suite.
 */

export interface Source {
  path: string
  content: string
}

const CASES = 'packages/use-cases/cases/'
/** A call at the start of a line: how a case declares itself, and not a test's text about one. */
const DECLARES = /^\s*useCase\(/m
/** Whatever brings code in: an import, a re-export, a dynamic import. */
const IMPORTS =
  /^\s*(?:import|export)\s[^'"]*\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm
/** What a case may import: Node, the language, and the player. */
const ALLOWED = [/^node:/, /^@abacus\/use-case-language$/, /\/src\/play\.ts$/]

export function casePlacementProblems(sources: Source[]): string[] {
  const problems: string[] = []
  for (const { path, content } of sources) {
    if (!path.startsWith(CASES)) {
      if (DECLARES.test(content)) problems.push(`case_outside_suite ${path}`)
      continue
    }
    for (const match of content.matchAll(IMPORTS)) {
      const target = (match[1] ?? match[2] ?? match[3]) as string
      if (!ALLOWED.some((allowed) => allowed.test(target)))
        problems.push(`case_outside_suite ${path} imports ${target}`)
    }
  }
  return problems
}

const root = fileURLToPath(new URL('../../../../', import.meta.url))

/** The code of the repository a case could hide in: the apps and packages, the player that defines useCase aside. */
export function repositorySources(): Source[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps', 'packages'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
    .filter((path) => path !== 'packages/use-cases/src/play.ts')
    .map((path) => ({ path, content: readFileSync(`${root}${path}`, 'utf8') }))
}
