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
    expectedRefundAmount: 100,
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
    expectedRefundAmount: 60,
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

test('a group breakdown folds every category carrying it into one mass', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })
  const friend = await createActor(user, { name: 'Friend' })
  const groceries = await createCategory(user, 'Groceries', 'Everyday life')
  const delivery = await createCategory(user, 'Delivery', 'Everyday life')
  const haircut = await createCategory(user, 'Haircut')

  const spend = async (amount: number, categoryId: string | undefined, day: string) =>
    await declareMovement(user, {
      happenedOn: day,
      amount,
      sourceAccountId: account.id,
      targetActorId: shop.id,
      categoryId,
    })

  await spend(60, groceries.id, '2026-04-02')
  await spend(30, delivery.id, '2026-04-03')
  // Advanced, so a refund can come back against it and pull net apart.
  const advanced = await declareMovement(user, {
    happenedOn: '2026-04-04',
    amount: 20,
    sourceAccountId: account.id,
    targetActorId: shop.id,
    categoryId: haircut.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 5,
  })
  // A movement with no category at all: it belongs to no group either.
  await spend(15, undefined, '2026-04-05')
  await declareMovement(user, {
    happenedOn: '2026-04-10',
    amount: 5,
    sourceActorId: friend.id,
    targetAccountId: account.id,
    refundsMovementId: advanced.id,
  })

  const rows = await spendingBreakdown(user, '2026-04-01', '2026-04-30', 'categoryGroup')
  assert.deepEqual(
    [...rows],
    [
      { key: 'Everyday life', label: 'Everyday life', gross: '90.00', net: '90.00', count: '2' },
      // The ungrouped category and the uncategorized movement are the same
      // mass: what no group accounts for.
      { key: null, label: null, gross: '35.00', net: '30.00', count: '2' },
    ],
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
