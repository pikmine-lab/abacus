import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  latestCheck,
  listChecks,
  recordBalanceCheck,
} from '../src/services/balanceChecks.ts'
import { createCategory } from '../src/services/catalog.ts'
import {
  closeAdvance,
  correctMovement,
  declareMovement,
  deleteMovement,
  listMovements,
  outstandingAdvances,
  refundAdvance,
} from '../src/services/movements.ts'
import { balanceSeries, spendingBreakdown } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('a balance check exposes the gap and an adjustment settles it', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const unknown = await createActor(user, { name: 'Unknown' })
  await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 1000,
    sourceActorId: employer.id,
    targetAccountId: account.id,
  })

  // Reality says 950: 50 of spending was never declared.
  const result = await recordBalanceCheck(user, account.id, 950, '2026-03-31')
  assert.equal(result.gap, -50)

  const adjustment = await createAdjustment(user, result.check.id, { actorId: unknown.id })
  assert.equal(adjustment.kind, 'expense')
  assert.equal(adjustment.amount, '50.00')
  assert.equal(adjustment.balanceCheckId, result.check.id)

  // After the adjustment the same declared balance matches.
  const again = await recordBalanceCheck(user, account.id, 950, '2026-03-31')
  assert.equal(again.gap, 0)
  await assert.rejects(
    createAdjustment(user, again.check.id, { actorId: unknown.id }),
    (e: DomainError) => e.code === 'no_gap',
  )
})

test('a settled gap stops asking for anything, without erasing what it found', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const unknown = await createActor(user, { name: 'Unknown' })
  await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 1000,
    sourceActorId: employer.id,
    targetAccountId: account.id,
  })

  const check = await recordBalanceCheck(user, account.id, 950, '2026-03-31')
  assert.equal(check.openGap, -50)

  // The computed side stays frozen at what the app said that day, so the gap
  // survives the settling: only the open one closes.
  const adjustment = await createAdjustment(user, check.check.id, { actorId: unknown.id })
  const after = (await latestCheck(user, account.id))!
  assert.equal(after.gap, -50)
  assert.equal(after.openGap, 0)
  assert.equal(after.adjustmentId, adjustment.id)

  // Removing the adjustment leaves the gap unexplained again.
  await deleteMovement(user, adjustment.id)
  const reopened = (await latestCheck(user, account.id))!
  assert.equal(reopened.openGap, -50)
  assert.equal(reopened.adjustmentId, null)
})

test('advances track partial refunds, net vs gross, and explicit write-off', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })
  const dining = await createCategory(user, 'Dining')

  const advance = await declareMovement(user, {
    happenedOn: '2026-04-10',
    amount: 100,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    categoryId: dining.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 100,
  })

  // Refunding must target a real advance.
  const plain = await declareMovement(user, {
    happenedOn: '2026-04-11',
    amount: 20,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    categoryId: dining.id,
  })
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-04-12',
      amount: 10,
      sourceActorId: friend.id,
      targetAccountId: account.id,
      refundsMovementId: plain.id,
    }),
    (e: DomainError) => e.code === 'not_an_advance',
  )

  await declareMovement(user, {
    happenedOn: '2026-04-15',
    amount: 50,
    sourceActorId: friend.id,
    targetAccountId: account.id,
    refundsMovementId: advance.id,
  })

  const open = await outstandingAdvances(user)
  assert.equal(open.length, 1)
  assert.equal(open[0]!.id, advance.id)
  assert.equal(open[0]!.refunded, '50.00')

  // Gross keeps the full outflow; net deducts only what actually came back.
  // The row also carries the grouping id and the movement count, so a report
  // line can link to the movements behind it.
  const breakdown = await spendingBreakdown(user, '2026-04-01', '2026-04-30', 'category')
  assert.deepEqual(
    [...breakdown],
    [{ key: dining.id, label: 'Dining', gross: '120.00', net: '70.00', count: '2' }],
  )

  // "They will never pay the rest": the claim closes, the expense stays whole.
  await closeAdvance(user, advance.id)
  assert.deepEqual([...(await outstandingAdvances(user))], [])
  const after = await spendingBreakdown(user, '2026-04-01', '2026-04-30', 'category')
  assert.deepEqual(
    [...after],
    [{ key: dining.id, label: 'Dining', gross: '120.00', net: '70.00', count: '2' }],
  )
})

test('balance series runs the daily cumulative sum per account', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const employer = await createActor(user, { name: 'Employer' })

  await declareMovement(user, {
    happenedOn: '2026-05-02',
    amount: 1000,
    sourceActorId: employer.id,
    targetAccountId: checking.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-05-04',
    amount: 300,
    sourceAccountId: checking.id,
    targetAccountId: savings.id,
  })

  const rows = await balanceSeries(user, '2026-05-01', '2026-05-05')
  const at = (day: string, accountId: string) =>
    rows.find((r) => r.day === day && r.accountId === accountId)?.balance

  assert.equal(rows.length, 10) // 5 days x 2 accounts
  assert.equal(at('2026-05-01', checking.id), '0.00')
  assert.equal(at('2026-05-02', checking.id), '1000.00')
  assert.equal(at('2026-05-03', savings.id), '0.00')
  assert.equal(at('2026-05-04', checking.id), '700.00')
  assert.equal(at('2026-05-05', savings.id), '300.00')
})

/** Re-reads a movement: the service exposes lists, not a get by id. */
async function reread(userId: string, id: string) {
  const found = (await listMovements(userId)).find((m) => m.id === id)
  assert.ok(found, 'the movement is gone')
  return found
}

test('correcting a check re-checks it, and its adjustment follows', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const unknown = await createActor(user, { name: 'Unknown' })
  await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 1000,
    sourceActorId: employer.id,
    targetAccountId: account.id,
  })
  const check = (await recordBalanceCheck(user, account.id, 950, '2026-03-31')).check
  const adjustment = await createAdjustment(user, check.id, { actorId: unknown.id })

  // The real balance was 900, not 950: the gap widens and the adjustment with
  // it, recomputed against the history minus that very adjustment.
  const wider = await correctBalanceCheck(user, check.id, { declaredBalance: 900 })
  assert.equal(wider.gap, -100)
  assert.equal(wider.adjustmentId, adjustment.id)
  assert.equal((await reread(user, adjustment.id)).amount, '100.00')

  // 1050 instead: the money was missing the other way, so the adjustment flips.
  const flipped = await correctBalanceCheck(user, check.id, { declaredBalance: 1050 })
  assert.equal(flipped.gap, 50)
  const income = await reread(user, adjustment.id)
  assert.equal(income.kind, 'income')
  assert.equal(income.amount, '50.00')
  assert.equal(income.sourceActorId, unknown.id)
  assert.equal(income.targetAccountId, account.id)

  // Nothing left to settle: the adjustment goes, it had no other reason to be.
  const settled = await correctBalanceCheck(user, check.id, { declaredBalance: 1000 })
  assert.equal(settled.gap, 0)
  assert.equal(settled.adjustmentId, null)
  assert.equal((await listMovements(user)).length, 1)
})

test('correcting the date of a check moves its adjustment to that date', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const unknown = await createActor(user, { name: 'Unknown' })
  await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 1000,
    sourceActorId: employer.id,
    targetAccountId: account.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-04-05',
    amount: 200,
    sourceAccountId: account.id,
    targetActorId: employer.id,
  })
  const check = (await recordBalanceCheck(user, account.id, 950, '2026-03-31')).check
  const adjustment = await createAdjustment(user, check.id, { actorId: unknown.id })

  // The balance was read on 30 April, not 31 March: the books say 800 then, so
  // the 950 declared means 150 of inflows are missing.
  const moved = await correctBalanceCheck(user, check.id, { checkedOn: '2026-04-30' })
  assert.equal(moved.check.computedBalance, '800.00')
  assert.equal(moved.gap, 150)
  const row = await reread(user, adjustment.id)
  assert.equal(row.happenedOn, '2026-04-30')
  assert.equal(row.kind, 'income')
  assert.equal(row.amount, '150.00')
})

test('a check is settled once, and deleting it takes its adjustment along', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const unknown = await createActor(user, { name: 'Unknown' })
  const check = (await recordBalanceCheck(user, account.id, -40, '2026-06-30')).check
  await createAdjustment(user, check.id, { actorId: unknown.id })

  await assert.rejects(
    createAdjustment(user, check.id, { actorId: unknown.id }),
    (e: DomainError) => e.code === 'check_already_settled',
  )

  await deleteBalanceCheck(user, check.id)
  assert.deepEqual([...(await listChecks(user, account.id))], [])
  assert.deepEqual([...(await listMovements(user))], [])
  await assert.rejects(
    correctBalanceCheck(user, check.id, { declaredBalance: 0 }),
    (e: DomainError) => e.code === 'check_not_found',
  )
})

test('an advance is owed its share, not the whole expense', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })

  // Four at the table, three of them owing their share.
  const advance = await declareMovement(user, {
    happenedOn: '2026-08-10',
    amount: 120,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 90,
  })
  assert.equal(advance.expectedRefundAmount, '90.00')

  const [open] = await outstandingAdvances(user)
  assert.equal(open!.expectedRefundAmount, '90.00')
  assert.equal(open!.refunded, '0.00')

  // The claim is settled at its share: the remaining 30 was never owed.
  const refund = await refundAdvance(user, advance.id, { amount: 90, on: '2026-08-12' })
  assert.equal(refund.kind, 'income')
  assert.equal(refund.amount, '90.00')
  assert.equal(refund.refundsMovementId, advance.id)
  assert.equal(refund.targetAccountId, account.id)
  assert.equal(refund.sourceActorId, friend.id)
  assert.deepEqual([...(await outstandingAdvances(user))], [])
})

test('a refund defaults to what is still owed, and closes the claim in steps', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })

  const advance = await declareMovement(user, {
    happenedOn: '2026-08-14',
    amount: 80,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 60,
  })

  await refundAdvance(user, advance.id, { amount: 20, on: '2026-08-15' })
  const [half] = await outstandingAdvances(user)
  assert.equal(half!.refunded, '20.00')

  // No amount given: what is left of the claim, not of the expense.
  const rest = await refundAdvance(user, advance.id, { on: '2026-08-16' })
  assert.equal(rest.amount, '40.00')
  assert.deepEqual([...(await outstandingAdvances(user))], [])
})

test('an advance refunded on the spot writes both movements at once', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })

  const advance = await declareMovement(user, {
    happenedOn: '2026-08-18',
    amount: 50,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 25,
    refundedNow: true,
  })

  // Nothing is owed any more, and the account only really lost the other half.
  assert.deepEqual([...(await outstandingAdvances(user))], [])
  const [balance] = await balanceSeries(user, '2026-08-18', '2026-08-18')
  assert.equal(balance!.balance, '-25.00')
  const movements = await listMovements(user)
  assert.equal(movements.length, 2)
  assert.equal(movements.find((m) => m.kind === 'income')!.refundsMovementId, advance.id)
})

test('a claim is correctable, unless a refund already contradicts the correction', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })
  const other = await createActor(user, { name: 'Sam' })

  const advance = await declareMovement(user, {
    happenedOn: '2026-08-20',
    amount: 100,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 100,
  })

  // The share was wrong, and so was the debtor.
  const fixed = await correctMovement(user, advance.id, {
    expectedRefundFromActorId: other.id,
    expectedRefundAmount: 40,
  })
  assert.equal(fixed.expectedRefundFromActorId, other.id)
  assert.equal(fixed.expectedRefundAmount, '40.00')

  // Never more than what left the account.
  await assert.rejects(
    correctMovement(user, advance.id, { expectedRefundAmount: 140 }),
    (e: DomainError) => e.code === 'advance_amount_too_large',
  )
  // And never half a claim.
  await assert.rejects(
    correctMovement(user, advance.id, { expectedRefundFromActorId: null }),
    (e: DomainError) => e.code === 'advance_needs_actor',
  )

  await refundAdvance(user, advance.id, { amount: 40, on: '2026-08-21' })

  // What came back is a fact: the claim cannot be dropped under it, nor shrunk
  // below it.
  await assert.rejects(
    correctMovement(user, advance.id, {
      expectedRefundFromActorId: null,
      expectedRefundAmount: null,
    }),
    (e: DomainError) => e.code === 'advance_has_refund',
  )
  await assert.rejects(
    correctMovement(user, advance.id, { expectedRefundAmount: 10 }),
    (e: DomainError) => e.code === 'advance_below_refunds',
  )
})

test('a claim needs an amount, an actor, and an expense to sit on', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const friend = await createActor(user, { name: 'Alex' })
  const base = { happenedOn: '2026-08-22', amount: 30, sourceAccountId: account.id }

  await assert.rejects(
    declareMovement(user, { ...base, targetActorId: restaurant.id, expectedRefundFromActorId: friend.id }),
    (e: DomainError) => e.code === 'advance_needs_amount',
  )
  await assert.rejects(
    declareMovement(user, { ...base, targetActorId: restaurant.id, expectedRefundAmount: 10 }),
    (e: DomainError) => e.code === 'advance_needs_actor',
  )
  await assert.rejects(
    declareMovement(user, {
      ...base,
      targetActorId: restaurant.id,
      expectedRefundFromActorId: friend.id,
      expectedRefundAmount: 31,
    }),
    (e: DomainError) => e.code === 'advance_amount_too_large',
  )
  // A transfer between owned accounts cannot be owed back by anyone.
  await assert.rejects(
    declareMovement(user, {
      ...base,
      targetAccountId: savings.id,
      expectedRefundFromActorId: friend.id,
      expectedRefundAmount: 10,
    }),
    (e: DomainError) => e.code === 'advance_is_expense',
  )
})
