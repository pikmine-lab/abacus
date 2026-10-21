import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))

test('the test helpers refuse to load against a database that is not a test one', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./packages/core/test/helpers.ts')"],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: 'postgresql://abacus:abacus@127.0.0.1:5544/abacus' },
          stdio: 'pipe',
        },
      ),
    (error: { stderr?: Buffer }) => String(error.stderr).includes('not_a_test_database'),
  )
})
