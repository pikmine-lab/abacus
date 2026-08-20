import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createCategory } from '../src/services/catalog.ts'
import { declareMovement } from '../src/services/movements.ts'
import { firstMovementDay, flowTotals, monthlyFlows, spendingBreakdown } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('period totals separate what was earned from what came back as a refund', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const employer = await createActor(user, { name: 'Employer' })
  const friend = await createActor(user, { name: 'Friend' })
  const restaurant = await createActor(user, { name: 'Restaurant' })

  await declareMovement(user, {
    happenedOn: '2026-06-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: account.id,
  })
  // An advance of 100, half of it refunded later in the same period.
  const advance = await declareMovement(user, {
    happenedOn: '2026-06-05',
    amount: 100,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-20',
    amount: 40,
    sourceActorId: friend.id,
    targetAccountId: account.id,
    refundsMovementId: advance.id,
  })
  // Internal transfers belong to neither side of the ledger.
  await declareMovement(user, {
    happenedOn: '2026-06-25',
    amount: 500,
    sourceAccountId: account.id,
    targetAccountId: savings.id,
  })

  const totals = await flowTotals(user, '2026-06-01', '2026-06-30')
  assert.equal(totals.expenseGross, '100.00')
  assert.equal(totals.expenseNet, '60.00')
  // 2000 earned, not 2040: the 40 that came back is not income.
  assert.equal(totals.income, '2000.00')
  assert.equal(totals.expenseCount, '1')
  assert.equal(totals.incomeCount, '1')
})

test('monthly flows keep empty months, so a trend has no holes', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })

  await declareMovement(user, {
    happenedOn: '2026-01-10',
    amount: 30,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-03-10',
    amount: 70,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })

  const rows = await monthlyFlows(user, '2026-01-01', '2026-03-31')
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((r) => r.expenseGross),
    ['30.00', '0.00', '70.00'],
  )
})

test('an income breakdown groups by the actor that paid, refunds excluded', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const friend = await createActor(user, { name: 'Friend' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const salary = await createCategory(user, 'Salary')

  await declareMovement(user, {
    happenedOn: '2026-07-01',
    amount: 2500,
    sourceActorId: employer.id,
    targetAccountId: account.id,
    categoryId: salary.id,
  })
  const advance = await declareMovement(user, {
    happenedOn: '2026-07-02',
    amount: 60,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-07-03',
    amount: 60,
    sourceActorId: friend.id,
    targetAccountId: account.id,
    refundsMovementId: advance.id,
  })

  const byActor = await spendingBreakdown(user, '2026-07-01', '2026-07-31', 'actor', 'income')
  assert.deepEqual(
    [...byActor],
    [{ key: employer.id, label: 'Employer', gross: '2500.00', net: '2500.00', count: '1' }],
  )
})

test('the first movement day is null until something is declared', async () => {
  const user = await seedUser()
  assert.equal(await firstMovementDay(user), null)

  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })
  await declareMovement(user, {
    happenedOn: '2026-02-14',
    amount: 12,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  assert.equal(await firstMovementDay(user), '2026-02-14')
})
