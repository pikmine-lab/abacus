import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPlacement } from './check-test-placement.mjs'

const codes = (files) => checkPlacement(files).map(({ code, file }) => `${code} ${file}`)

test('a unit test in a test folder of the web, the MCP or the demo seed is refused, naming it', () => {
  assert.deepEqual(
    codes(['apps/web/test/x.test.ts', 'apps/mcp/test/y.test.ts', 'packages/data-seed/test/z.test.ts']),
    [
      'unit_test_outside_source apps/web/test/x.test.ts',
      'unit_test_outside_source apps/mcp/test/y.test.ts',
      'unit_test_outside_source packages/data-seed/test/z.test.ts',
    ],
  )
})

test('a unit test next to its file passes, whatever its extension', () => {
  assert.deepEqual(
    codes(['apps/web/src/lib/x.ts', 'apps/web/src/lib/x.test.ts', 'apps/web/src/c.test.tsx']),
    [],
  )
  assert.deepEqual(codes(['scripts/test-db.test.mjs']), [])
})

test('the test folders kept on purpose pass: packages/core, the Spec Kit extensions, the use case suite', () => {
  assert.deepEqual(
    codes([
      'packages/core/test/x.test.ts',
      'speckit/extensions/issue-sync/test/a.test.mjs',
      'packages/use-cases/cases/ledger/movements/declare-expense.test.ts',
    ]),
    [],
  )
})

test('a test named otherwise than <file>.test.<extension> is refused, naming it', () => {
  assert.deepEqual(
    codes(['apps/web/src/lib/x.spec.ts', 'apps/mcp/src/y-test.ts', 'apps/mcp/src/z_test.mjs']),
    [
      'test_file_misnamed apps/web/src/lib/x.spec.ts',
      'test_file_misnamed apps/mcp/src/y-test.ts',
      'test_file_misnamed apps/mcp/src/z_test.mjs',
    ],
  )
})

test('a file that only looks like a test by its folder or its name is not one', () => {
  assert.deepEqual(
    codes(['packages/core/test/helpers.ts', 'apps/web/src/lib/latest.ts', 'docs/contest.md']),
    [],
  )
})
