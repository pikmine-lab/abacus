import assert from 'node:assert/strict'
import { test } from 'node:test'
import { casePlacementProblems, repositorySources } from './case-placement.ts'

const problems = (files: Record<string, string>) =>
  casePlacementProblems(Object.entries(files).map(([path, content]) => ({ path, content })))

test('a case declared in a driver is refused with case_outside_suite, naming the file', () => {
  assert.deepEqual(
    problems({
      'apps/web/driver/ledger.ts': "useCase('ledger.movement.x', async () => {})",
      'packages/use-cases/cases/ledger/movements/x.test.ts': "useCase('ledger.movement.y', async () => {})",
    }),
    ['case_outside_suite apps/web/driver/ledger.ts'],
  )
})

test('a case that imports a driver or an interface is refused with case_outside_suite', () => {
  assert.deepEqual(
    problems({
      'packages/use-cases/cases/ledger/movements/x.test.ts':
        "import { webDriver } from '@abacus/web/driver'\nuseCase('x', async () => {})",
      'packages/use-cases/cases/ledger/movements/y.test.ts':
        "import { listAccounts } from '@abacus/core/services/accounts'\nuseCase('y', async () => {})",
    }),
    [
      'case_outside_suite packages/use-cases/cases/ledger/movements/x.test.ts imports @abacus/web/driver',
      'case_outside_suite packages/use-cases/cases/ledger/movements/y.test.ts imports @abacus/core/services/accounts',
    ],
  )
})

test('a case that reaches a driver by a dynamic import or a re-export is refused with case_outside_suite', () => {
  assert.deepEqual(
    problems({
      'packages/use-cases/cases/ledger/movements/x.test.ts':
        "const { webDriver } = await import('@abacus/web/driver')\nuseCase('x', async () => {})",
      'packages/use-cases/cases/ledger/movements/y.test.ts':
        "export { mcpDriver } from '@abacus/mcp/driver'\nuseCase('y', async () => {})",
    }),
    [
      'case_outside_suite packages/use-cases/cases/ledger/movements/x.test.ts imports @abacus/web/driver',
      'case_outside_suite packages/use-cases/cases/ledger/movements/y.test.ts imports @abacus/mcp/driver',
    ],
  )
})

test('the code of the suite itself is searched, its player aside', () => {
  const paths = repositorySources().map((source) => source.path)
  assert.ok(paths.includes('packages/use-cases/src/play.test.ts'))
  assert.ok(!paths.includes('packages/use-cases/src/play.ts'))
})

test('a case that imports only the language, the player and Node passes', () => {
  assert.deepEqual(
    problems({
      'packages/use-cases/cases/ledger/movements/x.test.ts':
        "import assert from 'node:assert/strict'\nimport { eur } from '@abacus/use-case-language'\nimport { useCase } from '../../../src/play.ts'\nuseCase('x', async () => {})",
    }),
    [],
  )
})

test('the repository holds no case outside the suite', () => {
  assert.deepEqual(casePlacementProblems(repositorySources()), [])
})
