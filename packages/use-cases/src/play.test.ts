import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type CaseUser, type Driver, eur, type Steps } from '@abacus/use-case-language'
import { caseTestOptions, playCase, playedOn } from './play.ts'

/** The fake back every fake driver writes to, one ledger per user, as real drivers share the app. */
const ledgers = new Map<string, Map<string, number>>()

/** A driver that keeps balances in memory, with steps left out or failing on demand. */
function fakeDriver(name: string, change: (steps: Partial<Steps>) => Partial<Steps> = (s) => s): Driver {
  return {
    name,
    async open(user) {
      if (!ledgers.has(user.id)) ledgers.set(user.id, new Map())
      const balances = ledgers.get(user.id) as Map<string, number>
      const steps: Partial<Steps> = {
        async createAccount({ name, opening }) {
          balances.set(name, Number(opening?.amount ?? 0))
        },
        async declareExpense({ account, amount }) {
          balances.set(account, (balances.get(account) ?? 0) - Number(amount.amount))
        },
        async readAccountBalance(account) {
          return eur((balances.get(account) ?? 0).toFixed(2))
        },
      }
      return { steps: change(steps), close: async () => {} }
    },
  }
}

const preparation = fakeDriver('preparation')
let users = 0
const newUser = async (): Promise<CaseUser> => {
  users += 1
  return {
    id: `u${users}`,
    email: `u${users}@test.local`,
    password: 'x',
    cookie: '',
    accessToken: '',
    refreshToken: '',
  }
}

const expense = {
  id: 'ledger.movement.declare-expense',
  body: async ({ arrange, act }: { arrange: Steps; act: Steps }) => {
    await arrange.createAccount({ name: 'Courant', opening: eur('100.00') })
    await act.declareExpense({
      account: 'Courant',
      amount: eur('12.50'),
      payee: 'Boulangerie',
      on: '2026-03-10',
    })
    assert.deepEqual(await act.readAccountBalance('Courant'), eur('87.50'))
  },
}

test('a case passes on a driver that plays it right', async () => {
  await playCase(expense, fakeDriver('web'), { preparation, newUser })
})

test('a case fails on a driver that plays it wrong, and the failure names the case and the driver', async () => {
  const wrong = fakeDriver('mcp', (steps) => ({ ...steps, readAccountBalance: async () => eur('100.00') }))
  await assert.rejects(playCase(expense, wrong, { preparation, newUser }), (error: Error) => {
    assert.match(error.message, /ledger\.movement\.declare-expense/)
    assert.match(error.message, /mcp/)
    return true
  })
})

test('a step a driver does not know fails the case with step_not_implemented, naming case, step and driver', async () => {
  const partial = fakeDriver('mcp', ({ declareExpense: _, ...rest }) => rest)
  await assert.rejects(
    playCase(expense, partial, { preparation, newUser }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'step_not_implemented')
      for (const part of ['ledger.movement.declare-expense', 'declareExpense', 'mcp'])
        assert.ok(error.message.includes(part), part)
      return true
    },
  )
})

test('a step the interface refuses fails the case, the refusal text in the message', async () => {
  const refusing = fakeDriver('web', (steps) => ({
    ...steps,
    declareExpense: async () => {
      throw new Error('Ce compte est clos')
    },
  }))
  await assert.rejects(playCase(expense, refusing, { preparation, newUser }), (error: Error) => {
    for (const part of ['declareExpense', 'web', 'Ce compte est clos'])
      assert.ok(error.message.includes(part), part)
    return true
  })
})

test('each play of a case gets a user of its own, shared by its preparation and its driver', async () => {
  const seen: string[] = []
  const recording = (name: string): Driver => ({
    name,
    async open(user) {
      seen.push(`${name}:${user.id}`)
      return { steps: {}, close: async () => {} }
    },
  })
  const empty = { id: 'x', body: async () => {} }
  await playCase(empty, recording('web'), { preparation: recording('preparation'), newUser })
  await playCase(empty, recording('web'), { preparation: recording('preparation'), newUser })
  const [a, b, c, d] = seen.map((entry) => entry.split(':')[1])
  assert.equal(a, b)
  assert.equal(c, d)
  assert.notEqual(a, c)
})

test('a driver that cannot open its session fails the case, naming case and driver, and the preparation is closed', async () => {
  let preparationClosed = false
  const closing: Driver = {
    name: 'preparation',
    async open(user) {
      const session = await preparation.open(user)
      return {
        ...session,
        close: async () => {
          preparationClosed = true
        },
      }
    },
  }
  const broken: Driver = {
    name: 'web',
    async open() {
      throw new Error('browser did not start')
    },
  }
  await assert.rejects(playCase(expense, broken, { preparation: closing, newUser }), (error: Error) => {
    for (const part of ['ledger.movement.declare-expense', 'web', 'browser did not start'])
      assert.ok(error.message.includes(part), part)
    return true
  })
  assert.equal(preparationClosed, true)
})

/** A preparation driver that says whether its session was closed. */
function closingPreparation(): { driver: Driver; closed: () => boolean } {
  let closed = false
  return {
    driver: {
      name: 'preparation',
      async open(user) {
        const session = await preparation.open(user)
        return {
          ...session,
          close: async () => {
            closed = true
          },
        }
      },
    },
    closed: () => closed,
  }
}

/** A driver whose session fails to close. */
function failingToClose(change?: (steps: Partial<Steps>) => Partial<Steps>): Driver {
  const driver = fakeDriver('web', change)
  return {
    name: driver.name,
    async open(user) {
      const session = await driver.open(user)
      return {
        ...session,
        close: async () => {
          throw new Error('browser did not close')
        },
      }
    },
  }
}

test('a session that cannot close fails the case, naming case and driver, and the preparation is closed', async () => {
  const prepared = closingPreparation()
  await assert.rejects(
    playCase(expense, failingToClose(), { preparation: prepared.driver, newUser }),
    (error: Error) => {
      for (const part of ['ledger.movement.declare-expense', 'web', 'browser did not close'])
        assert.ok(error.message.includes(part), part)
      return true
    },
  )
  assert.equal(prepared.closed(), true)
})

test('a session that cannot close does not hide the failure of the case', async () => {
  const prepared = closingPreparation()
  const wrong = failingToClose((steps) => ({ ...steps, readAccountBalance: async () => eur('100.00') }))
  await assert.rejects(
    playCase(expense, wrong, { preparation: prepared.driver, newUser }),
    (error: Error) => {
      assert.match(error.message, /87\.50/)
      return true
    },
  )
  assert.equal(prepared.closed(), true)
})

test('a case marked unstable without a reason is refused with unstable_without_reason, naming it', () => {
  for (const unstable of ['', '   '])
    assert.throws(
      () => caseTestOptions('ledger.movement.x', { unstable }),
      (error: Error & { code?: string }) =>
        error.code === 'unstable_without_reason' && error.message.includes('ledger.movement.x'),
    )
})

test('a case marked unstable with its reason is played, and its failure is reported with the reason without failing the run', async () => {
  const options = caseTestOptions('ledger.movement.x', { unstable: 'the bank simulator answers late' })
  assert.deepEqual(options, { todo: 'unstable: the bank simulator answers late' })
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const file = `${mkdtempSync(`${tmpdir()}/unstable-`)}/x.test.mjs`
  writeFileSync(
    file,
    `import { test } from 'node:test'\ntest('x', ${JSON.stringify(options)}, () => { throw new Error('late') })\n`,
  )
  // Without the variable through which node:test drives its own children.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env
  const run = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env })
  assert.equal(run.status, 0, run.stdout)
  assert.match(run.stdout, /unstable: the bank simulator answers late/)
  assert.match(run.stdout, /late/)
})

test('a case not marked unstable is an ordinary test', () => {
  assert.deepEqual(caseTestOptions('x', {}), {})
})

test('a third declared driver plays every case, and a case about a gesture wherever the inventory does not say it is missing', () => {
  const declared = [{ name: 'web' }, { name: 'mcp' }, { name: 'cli' }]
  assert.deepEqual(
    playedOn({}, declared).map((d) => d.name),
    ['web', 'mcp', 'cli'],
  )
  assert.deepEqual(
    playedOn({ gesture: 'auth.sign-up' }, declared).map((d) => d.name),
    ['web', 'cli'],
  )
})
