// Where a unit test lives and how it is named.
//
// A unit test sits next to the file it tests, so what is tested shows in the
// tree, and is named <file>.test.<extension> after it. Refused:
// - unit_test_outside_source: a test in a test folder. Kept on purpose: the
//   tests of packages/core until their rewrite (#192), those of the Spec Kit
//   extensions, and the use case suite, which is not unit tests.
// - test_file_misnamed: any other test naming (x.spec.ts, x-test.ts, x_test.ts).
//
// Usage: node scripts/check-test-placement.mjs   (checks the files git tracks)

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = /\.[cm]?[jt]sx?$/
const WELL_NAMED = /\.test\.[cm]?[jt]sx?$/
const OTHER_NAMING = /([.\-_](spec|test))\.[cm]?[jt]sx?$/
const TEST_FOLDER = /(^|\/)(test|tests|__tests__)\//
const KEPT_FOLDERS = [
  /^packages\/core\/test\//,
  /^speckit\/extensions\/[^/]+\/test\//,
  /^packages\/use-cases\//,
]

export function checkPlacement(files) {
  const errors = []
  for (const file of files) {
    if (!SCRIPT.test(file) || file.includes('node_modules/') || file.startsWith('vendors/')) continue
    if (!WELL_NAMED.test(file)) {
      if (OTHER_NAMING.test(file)) errors.push({ code: 'test_file_misnamed', file })
      continue
    }
    if (TEST_FOLDER.test(file) && !KEPT_FOLDERS.some((kept) => kept.test(file)))
      errors.push({ code: 'unit_test_outside_source', file })
  }
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  }).split('\n')
  const errors = checkPlacement(files)
  for (const { code, file } of errors) console.error(`${code}: ${file}`)
  if (errors.length) {
    console.error('A unit test lives next to the file it tests, named <file>.test.<extension>.')
    process.exitCode = 1
  }
}
