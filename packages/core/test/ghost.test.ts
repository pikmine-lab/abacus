import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createAdjustment, recordBalanceCheck } from '../src/services/balanceChecks.ts'
import {
  correctMovement,
  declareMovement,
  listMovements,
  refundAdvance,
  selectionTotals,
} from '../src/services/movements.ts'
import { balanceSeries, flowTotals, monthlyFlows, spendingBreakdown } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function fixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const insurer = await createActor(user, { name: 'Insurer' })
  const shop = await createActor(user, { name: 'Shop' })
  return { account, savings, insurer, shop }
}

test('a ghost movement enters no analysis, in either reading', async () => {
  const user = await seedUser()
  const { account, insurer, shop } = await fixture(user)

  await declareMovement(user, {
    happenedOn: '2026-08-10',
    amount: 40,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  // A claim settled after a flood: it reached the account and says nothing
  // about the month.
  await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 3200,
    sourceActorId: insurer.id,
    targetAccountId: account.id,
    ghost: true,
  })

  for (const reading of ['cash', 'accrual'] as const) {
    const august = await flowTotals(user, '2026-08-01', '2026-08-31', reading)
    assert.equal(august.income, '0.00', reading)
    assert.equal(august.incomeCount, '0', reading)
    assert.equal(august.expenseNet, '40.00', reading)

    const byActor = await spendingBreakdown(user, '2026-08-01', '2026-08-31', 'actor', 'income', reading)
    assert.equal(byActor.length, 0, reading)

    const [month] = await monthlyFlows(user, '2026-08-01', '2026-08-31', reading)
    assert.equal(month!.income, '0.00', reading)
  }
})

test('a ghost movement is still money on the account, so the check sees it', async () => {
  const user = await seedUser()
  const { account, insurer } = await fixture(user)

  await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 3200,
    sourceActorId: insurer.id,
    targetAccountId: account.id,
    ghost: true,
  })

  const series = await balanceSeries(user, '2026-08-12', '2026-08-12')
  assert.equal(series.find((p) => p.accountId === account.id)!.balance, '3200.00')
  // The bank says 3200 too: a check that skipped ghosts would report a gap
  // here, and would miss a genuinely forgotten entry elsewhere.
  const check = await recordBalanceCheck(user, account.id, 3200, '2026-08-12')
  assert.equal(check.gap, 0)
})

test('an internal transfer cannot be a ghost, and drops the flag when it becomes one', async () => {
  const user = await seedUser()
  const { account, savings, shop } = await fixture(user)

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-08-12',
      amount: 500,
      sourceAccountId: account.id,
      targetAccountId: savings.id,
      ghost: true,
    }),
    (e: DomainError) => e.code === 'transfer_is_never_ghost',
  )

  // Declared as an expense by mistake: the flag goes with the nature it had.
  const movement = await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 500,
    sourceAccountId: account.id,
    targetActorId: shop.id,
    ghost: true,
  })
  const fixed = await correctMovement(user, movement.id, {
    sourceAccountId: account.id,
    targetAccountId: savings.id,
    sourceActorId: null,
    targetActorId: null,
  })
  assert.equal(fixed.kind, 'transfer')
  assert.equal(fixed.ghost, false)
})

test('a movement is marked and unmarked after the fact, and a date fix keeps the mark', async () => {
  const user = await seedUser()
  const { account, insurer } = await fixture(user)

  const movement = await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 3200,
    sourceActorId: insurer.id,
    targetAccountId: account.id,
  })
  assert.equal(movement.ghost, false)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).income, '3200.00')

  const hidden = await correctMovement(user, movement.id, { ghost: true })
  assert.equal(hidden.ghost, true)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).income, '0.00')

  // Correcting something else keeps what was stated on purpose.
  const moved = await correctMovement(user, movement.id, { happenedOn: '2026-08-14' })
  assert.equal(moved.ghost, true)

  const back = await correctMovement(user, movement.id, { ghost: false })
  assert.equal(back.ghost, false)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).income, '3200.00')
})

test('a balance adjustment counts in the analysis unless it is declared a ghost', async () => {
  const user = await seedUser()
  const { account, shop } = await fixture(user)
  const unknown = await createActor(user, { name: 'Unknown' })

  await declareMovement(user, {
    happenedOn: '2026-08-01',
    amount: 100,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  // The bank is 50 lower than the books: outflows are missing.
  const check = await recordBalanceCheck(user, account.id, -150, '2026-08-20')
  assert.equal(check.gap, -50)

  const counted = await createAdjustment(user, check.check.id, { actorId: unknown.id })
  assert.equal(counted.ghost, false)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).expenseGross, '150.00')

  // The same gap again, told as a regularisation that explains nothing.
  const second = await recordBalanceCheck(user, account.id, -200, '2026-08-25')
  const ghost = await createAdjustment(user, second.check.id, { actorId: unknown.id, ghost: true })
  assert.equal(ghost.ghost, true)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).expenseGross, '150.00')
  // And the account still says what the bank says.
  assert.equal((await recordBalanceCheck(user, account.id, -200, '2026-08-26')).gap, 0)
})

test('the movement list still shows a ghost, its totals no longer count it', async () => {
  const user = await seedUser()
  const { account, insurer, shop } = await fixture(user)

  await declareMovement(user, {
    happenedOn: '2026-08-10',
    amount: 40,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 3200,
    sourceActorId: insurer.id,
    targetAccountId: account.id,
    ghost: true,
  })

  const filters = { from: '2026-08-01', to: '2026-08-31' }
  const movements = await listMovements(user, filters)
  assert.equal(movements.length, 2)

  const selection = await selectionTotals(user, filters)
  // The count says how many rows the list holds; the sums answer what the
  // Analyse screen answers for the same window.
  assert.equal(selection.count, '2')
  assert.equal(selection.income, '0.00')
  assert.equal(selection.expense, '40.00')
})

test('a refund declared a ghost stops reducing what the period cost', async () => {
  const user = await seedUser()
  const { account, shop } = await fixture(user)
  const colleague = await createActor(user, { name: 'Colleague' })

  const advance = await declareMovement(user, {
    happenedOn: '2026-08-10',
    amount: 120,
    sourceAccountId: account.id,
    targetActorId: shop.id,
    expectedRefundFromActorId: colleague.id,
    expectedRefundAmount: 90,
  })
  const refund = await refundAdvance(user, advance.id, { on: '2026-08-15' })
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).expenseNet, '30.00')

  await correctMovement(user, refund.id, { ghost: true })
  const totals = await flowTotals(user, '2026-08-01', '2026-08-31')
  assert.equal(totals.expenseGross, '120.00')
  assert.equal(totals.expenseNet, '120.00')
})
