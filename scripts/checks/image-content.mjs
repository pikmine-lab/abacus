// What a production image must not carry: test files, test or driver folders,
// and anything of the use case suite, whose shortcut signs users in without a
// screen. Run on the files of a built image (its /app), outside the
// dependencies, which ship their own tests and are not ours.
//
// Refused: test_file (x.test.ts, x.spec.ts), test_folder (test/, tests/,
// __tests__/), driver_folder (driver/), suite_marker (a file holding the
// suite's marker, packages/use-cases/src/environment/accounts.ts).
//
// Usage: node scripts/checks/image-content.mjs <image root>

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUITE_MARKER = 'abacus-use-case-suite-shortcut'
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const TEST_FOLDER = new Set(['test', 'tests', '__tests__'])
const LARGEST_READ = 5 * 1024 * 1024

export function checkImage(root) {
  const findings = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      const shown = relative(root, path)
      if (entry.isDirectory()) {
        if (TEST_FOLDER.has(entry.name)) findings.push({ code: 'test_folder', path: shown })
        else if (entry.name === 'driver') findings.push({ code: 'driver_folder', path: shown })
        else walk(path)
      } else if (entry.isFile()) {
        if (TEST_FILE.test(entry.name)) findings.push({ code: 'test_file', path: shown })
        else if (statSync(path).size <= LARGEST_READ && readFileSync(path, 'latin1').includes(SUITE_MARKER))
          findings.push({ code: 'suite_marker', path: shown })
      }
    }
  }
  walk(root)
  return findings
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
  if (!root) {
    console.error('usage: image-content.mjs <image root>')
    process.exitCode = 2
  } else {
    const findings = checkImage(root)
    for (const { code, path } of findings) console.error(`${code}: ${path}`)
    if (findings.length) process.exitCode = 1
    else console.log(`check-image-content: ${root} carries no test, driver nor suite code.`)
  }
}
