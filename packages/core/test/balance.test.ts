import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createAdjustment, recordBalanceCheck } from '../src/services/balanceChecks.ts'
import { createCategory } from '../src/services/catalog.ts'
import { closeAdvance, declareMovement, outstandingAdvances } from '../src/services/movements.ts'
import { spendingBreakdown } from '../src/services/reports.ts'
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
  const breakdown = await spendingBreakdown(user, '2026-04-01', '2026-04-30', 'category')
  assert.deepEqual([...breakdown], [{ label: 'Dining', gross: '120.00', net: '70.00' }])

  // "They will never pay the rest": the claim closes, the expense stays whole.
  await closeAdvance(user, advance.id)
  assert.deepEqual([...(await outstandingAdvances(user))], [])
  const after = await spendingBreakdown(user, '2026-04-01', '2026-04-30', 'category')
  assert.deepEqual([...after], [{ label: 'Dining', gross: '120.00', net: '70.00' }])
})
