import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, createCategory } from '../src/services/catalog.ts'
import { createLevy } from '../src/services/levies.ts'
import { declareMovement } from '../src/services/movements.ts'
import {
  firstDeclaredDay,
  flowLeaves,
  flowMovements,
  flowTotals,
  monthlyFlows,
  spendingBreakdown,
  spendingByCategoryGroup,
} from '../src/services/reports.ts'
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

test('a group breakdown folds every category carrying it into one mass, and unfolds back into them', async () => {
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

  // Same masses, each keeping what it merges, so a group can be drilled into
  // without an entity of its own: totals agree with the breakdown above, and
  // every level is ordered by weight.
  const masses = await spendingByCategoryGroup(user, '2026-04-01', '2026-04-30')
  assert.deepEqual(
    [...masses],
    [
      {
        key: 'Everyday life',
        label: 'Everyday life',
        gross: '90.00',
        net: '90.00',
        count: '2',
        categories: [
          { key: groceries.id, label: 'Groceries', gross: '60.00', net: '60.00', count: '1' },
          { key: delivery.id, label: 'Delivery', gross: '30.00', net: '30.00', count: '1' },
        ],
      },
      {
        key: null,
        label: null,
        gross: '35.00',
        net: '30.00',
        count: '2',
        categories: [
          { key: haircut.id, label: 'Haircut', gross: '20.00', net: '15.00', count: '1' },
          { key: null, label: null, gross: '15.00', net: '15.00', count: '1' },
        ],
      },
    ],
  )
})

test('the first declared day is null until something is declared', async () => {
  const user = await seedUser()
  assert.equal(await firstDeclaredDay(user), null)

  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })
  await declareMovement(user, {
    happenedOn: '2026-02-14',
    amount: 12,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
  assert.equal(await firstDeclaredDay(user), '2026-02-14')
})

/**
 * A business activity whose contributions settle in their own category, the
 * account it lives on, a personal account, and the agency the contributions
 * are paid to.
 */
async function freelance(user: string) {
  const personal = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const business = await createAccount({ userId: user, name: 'Business', behavior: 'payment' })
  const activity = await createActivity(user, {
    name: 'Freelance',
    kind: 'business',
    startedOn: '2026-01-01',
    accountIds: [business.id],
  })
  const contributions = await createCategory(user, 'Contributions')
  await createLevy(user, {
    activityId: activity.id,
    name: 'Contributions',
    kind: 'social',
    validFrom: '2026-01-01',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 25,
    period: 'month',
    due: { type: 'end_of_next_month' },
    settlementCategoryId: contributions.id,
  })
  const agency = await createActor(user, { name: 'Agency' })
  const employer = await createActor(user, { name: 'Employer' })
  return { personal, business, activity, contributions, agency, employer }
}

test("a business activity's income reads net of its regime's charges, which leave the expenses", async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency, employer } = await freelance(user)
  const client = await createActor(user, { name: 'Client' })
  const shop = await createActor(user, { name: 'Shop' })
  const equipment = await createCategory(user, 'Equipment')

  await declareMovement(user, {
    happenedOn: '2026-06-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: personal.id,
  })
  // The activity receives 100, pays 25 of contributions, buys a 30 computer
  // and pays its owner 45.
  await declareMovement(user, {
    happenedOn: '2026-06-03',
    amount: 100,
    sourceActorId: client.id,
    targetAccountId: business.id,
    activityId: activity.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-12',
    amount: 30,
    sourceAccountId: business.id,
    targetActorId: shop.id,
    categoryId: equipment.id,
    activityId: activity.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-20',
    amount: 45,
    sourceAccountId: business.id,
    targetAccountId: personal.id,
  })

  const totals = await flowTotals(user, '2026-06-01', '2026-06-30')
  assert.equal(totals.income, '2075.00')
  // The computer stays an expense; the contributions do not.
  assert.equal(totals.expenseGross, '30.00')
  assert.equal(totals.expenseNet, '30.00')
  assert.equal(totals.expenseCount, '1')
  assert.equal(totals.incomeCount, '2')
  // What the accounts took is unchanged: 2000 + 100 - 25 - 30.
  assert.equal(Number(totals.income) - Number(totals.expenseNet), 2045)

  const [june] = await monthlyFlows(user, '2026-06-01', '2026-06-30')
  assert.equal(june!.income, '2075.00')
  assert.equal(june!.expenseGross, '30.00')
  assert.equal(june!.expenseNet, '30.00')

  const spent = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'category')
  assert.deepEqual(
    spent.map((r) => r.label),
    ['Equipment'],
  )
  const earned = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'activity', 'income')
  assert.deepEqual(
    [...earned],
    [
      { key: null, label: null, gross: '2000.00', net: '2000.00', count: '1' },
      { key: activity.id, label: 'Freelance', gross: '75.00', net: '75.00', count: '1' },
    ],
  )
})

test("an activity's charges come off its incomes pro rata when the ranking is by actor or category", async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency, employer } = await freelance(user)
  const first = await createActor(user, { name: 'First client' })
  const second = await createActor(user, { name: 'Second client' })
  const salary = await createCategory(user, 'Salary')
  const fees = await createCategory(user, 'Fees')

  await declareMovement(user, {
    happenedOn: '2026-06-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: personal.id,
    categoryId: salary.id,
  })
  for (const [client, amount] of [
    [first, 60],
    [second, 40],
  ] as const)
    await declareMovement(user, {
      happenedOn: '2026-06-05',
      amount,
      sourceActorId: client.id,
      targetAccountId: business.id,
      categoryId: fees.id,
      activityId: activity.id,
    })
  await declareMovement(user, {
    happenedOn: '2026-06-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
  })

  // A quarter of what came in went to the charges, so each client keeps
  // three quarters of what they paid.
  const byActor = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'actor', 'income')
  assert.deepEqual(
    [...byActor],
    [
      { key: employer.id, label: 'Employer', gross: '2000.00', net: '2000.00', count: '1' },
      { key: first.id, label: 'First client', gross: '45.00', net: '45.00', count: '1' },
      { key: second.id, label: 'Second client', gross: '30.00', net: '30.00', count: '1' },
    ],
  )
  const byCategory = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'category', 'income')
  assert.deepEqual(
    [...byCategory],
    [
      { key: salary.id, label: 'Salary', gross: '2000.00', net: '2000.00', count: '1' },
      { key: fees.id, label: 'Fees', gross: '75.00', net: '75.00', count: '2' },
    ],
  )
  const totals = await flowTotals(user, '2026-06-01', '2026-06-30')
  assert.equal(totals.income, '2075.00')
})

test('charges paid in a window that received nothing are a loss, read as expenses', async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency, employer } = await freelance(user)
  const client = await createActor(user, { name: 'Client' })

  await declareMovement(user, {
    happenedOn: '2026-06-05',
    amount: 100,
    sourceActorId: client.id,
    targetAccountId: business.id,
    activityId: activity.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-07-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: personal.id,
  })
  // June's contributions, paid in July and attached to June.
  await declareMovement(user, {
    happenedOn: '2026-07-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
    accrualMonth: '2026-06',
  })

  const july = await flowTotals(user, '2026-07-01', '2026-07-31')
  assert.equal(july.income, '2000.00')
  assert.equal(july.expenseGross, '25.00')
  assert.equal(july.expenseNet, '25.00')
  assert.equal(july.expenseCount, '1')
  const earned = await spendingBreakdown(user, '2026-07-01', '2026-07-31', 'activity', 'income')
  assert.deepEqual([...earned], [{ key: null, label: null, gross: '2000.00', net: '2000.00', count: '1' }])
  const spent = await spendingBreakdown(user, '2026-07-01', '2026-07-31', 'category')
  assert.deepEqual(
    [...spent],
    [{ key: contributions.id, label: 'Contributions', gross: '25.00', net: '25.00', count: '1' }],
  )

  // Read over both months, the charges come off what they were paid for.
  const both = await flowTotals(user, '2026-06-01', '2026-07-31')
  assert.equal(both.income, '2075.00')
  assert.equal(both.expenseGross, '0.00')

  // Read by attached month, the charges land on the receipts they pay for.
  const juneAccrual = await flowTotals(user, '2026-06-01', '2026-06-30', 'accrual')
  assert.equal(juneAccrual.income, '75.00')
  const julyAccrual = await flowTotals(user, '2026-07-01', '2026-07-31', 'accrual')
  assert.equal(julyAccrual.income, '2000.00')
})

test('charges beyond what came in are a loss for what exceeds, shared by the payments', async () => {
  const user = await seedUser()
  const { business, activity, contributions, agency } = await freelance(user)
  const client = await createActor(user, { name: 'Client' })

  await declareMovement(user, {
    happenedOn: '2026-06-03',
    amount: 100,
    sourceActorId: client.id,
    targetAccountId: business.id,
    activityId: activity.id,
  })
  for (const amount of [90, 60])
    await declareMovement(user, {
      happenedOn: '2026-06-10',
      amount,
      sourceAccountId: business.id,
      targetActorId: agency.id,
      categoryId: contributions.id,
      activityId: activity.id,
    })

  const totals = await flowTotals(user, '2026-06-01', '2026-06-30')
  assert.equal(totals.income, '0.00')
  assert.equal(totals.incomeCount, '0')
  assert.equal(totals.expenseNet, '50.00')
  assert.equal(totals.expenseCount, '2')
  const earned = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'activity', 'income')
  assert.deepEqual([...earned], [])
  const spent = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'actor')
  assert.deepEqual(
    [...spent],
    [{ key: agency.id, label: 'Agency', gross: '50.00', net: '50.00', count: '2' }],
  )
})

test("only a settlement of the activity's own rules changes side, net of what came back", async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency } = await freelance(user)
  const client = await createActor(user, { name: 'Client' })

  await declareMovement(user, {
    happenedOn: '2026-06-03',
    amount: 100,
    sourceActorId: client.id,
    targetAccountId: business.id,
    activityId: activity.id,
  })
  // Filed in the same category outside the activity: no rule settles it.
  await declareMovement(user, {
    happenedOn: '2026-06-04',
    amount: 10,
    sourceAccountId: personal.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: null,
  })
  // A ghost says nothing about the flows, settlement or not.
  await declareMovement(user, {
    happenedOn: '2026-06-05',
    amount: 50,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
    ghost: true,
  })
  // Overpaid by 5, which the agency sent back.
  const overpaid = await declareMovement(user, {
    happenedOn: '2026-06-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
    expectedRefundFromActorId: agency.id,
    expectedRefundAmount: 5,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-20',
    amount: 5,
    sourceActorId: agency.id,
    targetAccountId: business.id,
    refundsMovementId: overpaid.id,
  })

  const totals = await flowTotals(user, '2026-06-01', '2026-06-30')
  assert.equal(totals.income, '80.00')
  assert.equal(totals.expenseGross, '10.00')
  assert.equal(totals.expenseNet, '10.00')
  // 100 - 10 - 25 + 5, as before the charges changed side.
  assert.equal(Number(totals.income) - Number(totals.expenseNet), 70)
})

test('the movements behind a row add up to it, each counted as the row counts it', async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency } = await freelance(user)
  const groceries = await createCategory(user, 'Groceries')
  const fees = await createCategory(user, 'Fees')
  const market = await createActor(user, { name: 'Market' })
  const bakery = await createActor(user, { name: 'Bakery' })
  const friend = await createActor(user, { name: 'Friend' })
  const first = await createActor(user, { name: 'First client' })
  const second = await createActor(user, { name: 'Second client' })

  // An advance half refunded, a plain purchase, and a ghost the row ignores.
  const advance = await declareMovement(user, {
    happenedOn: '2026-06-02',
    amount: 80,
    sourceAccountId: personal.id,
    targetActorId: market.id,
    categoryId: groceries.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 40,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-15',
    amount: 40,
    sourceActorId: friend.id,
    targetAccountId: personal.id,
    refundsMovementId: advance.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-04',
    amount: 50,
    sourceAccountId: personal.id,
    targetActorId: bakery.id,
    categoryId: groceries.id,
    note: 'Cake',
  })
  await declareMovement(user, {
    happenedOn: '2026-06-06',
    amount: 900,
    sourceAccountId: personal.id,
    targetActorId: market.id,
    categoryId: groceries.id,
    ghost: true,
  })
  // Two incomes of the activity, a quarter of which its charges take back.
  for (const [client, amount] of [
    [first, 60],
    [second, 40],
  ] as const)
    await declareMovement(user, {
      happenedOn: '2026-06-05',
      amount,
      sourceActorId: client.id,
      targetAccountId: business.id,
      categoryId: fees.id,
      activityId: activity.id,
    })
  await declareMovement(user, {
    happenedOn: '2026-06-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
  })

  const spent = await flowMovements(
    user,
    '2026-06-01',
    '2026-06-30',
    'expense',
    'cash',
    { categoryId: groceries.id },
    10,
  )
  assert.deepEqual(spent, {
    movements: [
      {
        id: spent.movements[0]!.id,
        happenedOn: '2026-06-04',
        actorId: bakery.id,
        actor: 'Bakery',
        note: 'Cake',
        gross: '50.00',
        net: '50.00',
      },
      {
        id: advance.id,
        happenedOn: '2026-06-02',
        actorId: market.id,
        actor: 'Market',
        note: null,
        gross: '80.00',
        net: '40.00',
      },
    ],
    rest: null,
  })
  const [row] = await spendingBreakdown(user, '2026-06-01', '2026-06-30', 'category', 'expense', 'cash', {
    categoryId: groceries.id,
  })
  assert.equal(row!.net, '90.00')
  assert.equal(row!.gross, '130.00')

  const earned = await flowMovements(
    user,
    '2026-06-01',
    '2026-06-30',
    'income',
    'cash',
    { categoryId: fees.id },
    10,
  )
  assert.deepEqual(
    earned.movements.map((m) => [m.actor, m.net]),
    [
      ['First client', '45.00'],
      ['Second client', '30.00'],
    ],
  )

  // Cut after the first, the rest still accounts for the whole row.
  const cut = await flowMovements(
    user,
    '2026-06-01',
    '2026-06-30',
    'expense',
    'cash',
    { categoryId: groceries.id },
    1,
  )
  assert.equal(cut.movements.length, 1)
  assert.deepEqual(cut.rest, { count: '1', gross: '80.00', net: '40.00' })

  // Every category at once keeps its own biggest and its own rest.
  const all = await flowLeaves(user, '2026-06-01', '2026-06-30', 'income', 'cash', 1, ['category'])
  assert.deepEqual(
    all.movements.map((m) => [m.categoryId, m.actor, m.net]),
    [[fees.id, 'First client', '45.00']],
  )
  assert.deepEqual(all.rests, [
    { categoryId: fees.id, activityId: null, count: '1', gross: '30.00', net: '30.00' },
  ])
})

test('a row narrowed to an activity is the row the full ranking shows for it', async () => {
  const user = await seedUser()
  const { personal, business, activity, contributions, agency, employer } = await freelance(user)
  const client = await createActor(user, { name: 'Client' })
  const fees = await createCategory(user, 'Fees', 'Work')
  const salary = await createCategory(user, 'Salary', 'Work')

  await declareMovement(user, {
    happenedOn: '2026-06-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: personal.id,
    categoryId: salary.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-03',
    amount: 100,
    sourceActorId: client.id,
    targetAccountId: business.id,
    categoryId: fees.id,
    activityId: activity.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-06-10',
    amount: 25,
    sourceAccountId: business.id,
    targetActorId: agency.id,
    categoryId: contributions.id,
    activityId: activity.id,
  })

  // The charges are settled over the whole window before the filter applies,
  // so the activity keeps its net of 75 rather than its 100 gross.
  const own = await spendingByCategoryGroup(user, '2026-06-01', '2026-06-30', 'income', 'cash', {
    activityId: activity.id,
  })
  assert.deepEqual(
    own.map((g) => [g.label, g.net, g.categories.map((c) => [c.label, c.net])]),
    [['Work', '75.00', [['Fees', '75.00']]]],
  )
  const none = await spendingByCategoryGroup(user, '2026-06-01', '2026-06-30', 'income', 'cash', {
    activityId: null,
  })
  assert.deepEqual(
    none.map((g) => [g.label, g.net, g.categories.map((c) => [c.label, c.net])]),
    [['Work', '2000.00', [['Salary', '2000.00']]]],
  )
})
