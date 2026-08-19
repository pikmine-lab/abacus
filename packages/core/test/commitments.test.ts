import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { addPeriod } from '../src/domain/period.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import {
  cancelCommitment,
  changeAmount,
  commitmentEvents,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  pendingOccurrences,
  skipNextOccurrence,
} from '../src/services/commitments.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('adds periods with end-of-month clamping', () => {
  assert.equal(addPeriod('2026-01-31', 'month', 1), '2026-02-28')
  assert.equal(addPeriod('2026-01-15', 'month', 1), '2026-02-15')
  assert.equal(addPeriod('2026-11-30', 'month', 3), '2027-02-28')
  assert.equal(addPeriod('2026-01-01', 'week', 2), '2026-01-15')
  assert.equal(addPeriod('2026-03-10', 'year', 1), '2027-03-10')
})

async function subscriptionFixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const actor = await createActor(user, { name: 'Netflix' })
  const subscription = await createSubscription(user, {
    label: 'Netflix',
    actorId: actor.id,
    accountId: account.id,
    amount: 13.49,
    periodUnit: 'month',
    firstDueOn: '2026-05-01',
  })
  return { account, actor, subscription }
}

test('confirming an occurrence creates the movement and advances the commitment', async () => {
  const user = await seedUser()
  const { subscription, account, actor } = await subscriptionFixture(user)

  const movement = await confirmNextOccurrence(user, subscription.id)

  assert.equal(movement.kind, 'expense')
  assert.equal(movement.amount, '13.49')
  assert.equal(movement.sourceAccountId, account.id)
  assert.equal(movement.targetActorId, actor.id)
  assert.equal(movement.commitmentId, subscription.id)

  const pending = await pendingOccurrences(user, '2026-06-30')
  assert.deepEqual(
    pending.map((p) => p.dueOn),
    ['2026-06-01'],
  )
})

test('expands several late occurrences and skips advance without a movement', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const pending = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    pending.map((p) => p.dueOn),
    ['2026-05-01', '2026-06-01', '2026-07-01'],
  )

  await skipNextOccurrence(user, subscription.id)
  const after = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    after.map((p) => p.dueOn),
    ['2026-06-01', '2026-07-01'],
  )
})

test('a price change updates the amount and leaves a dated event', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const updated = await changeAmount(user, subscription.id, 15.99, '2026-06-01')
  assert.equal(updated.amount, '15.99')

  // Events are ordered by occurrence date; the price change is backdated here,
  // so it comes before the creation event (dated today). Assert content, not order.
  const events = await commitmentEvents(user, subscription.id)
  const byType = new Map(events.map((e) => [e.type, e.amount]))
  assert.equal(byType.get('created'), '13.49')
  assert.equal(byType.get('price_changed'), '15.99')
  assert.equal(events.length, 2)
})

test('a cancelled subscription stops generating occurrences', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  await cancelCommitment(user, subscription.id, '2026-05-15')
  assert.deepEqual(await pendingOccurrences(user, '2026-12-31'), [])
  await assert.rejects(
    confirmNextOccurrence(user, subscription.id),
    (e: DomainError) => e.code === 'cancelled',
  )
})

test('a financing stops at its last installment and derives its total', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })
  const financing = await createFinancing(user, {
    label: 'Sofa x4',
    actorId: store.id,
    accountId: account.id,
    installmentAmount: 250,
    installmentsTotal: 4,
    firstDueOn: '2026-01-15',
  })
  assert.equal(financing.totalAmount, '1000.00')

  // Even far in the future, only 4 occurrences ever exist.
  const pending = await pendingOccurrences(user, '2027-12-31')
  assert.equal(pending.filter((p) => p.commitment.id === financing.id).length, 4)

  for (let i = 0; i < 4; i++) await confirmNextOccurrence(user, financing.id)
  await assert.rejects(
    confirmNextOccurrence(user, financing.id),
    (e: DomainError) => e.code === 'financing_settled',
  )
  assert.deepEqual(await pendingOccurrences(user, '2027-12-31'), [])
})

test('an incoming commitment (salary) confirms into an income', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const salary = await createSubscription(user, {
    label: 'Salary',
    actorId: employer.id,
    accountId: account.id,
    direction: 'incoming',
    amount: 2500,
    periodUnit: 'month',
    firstDueOn: '2026-05-28',
  })

  const movement = await confirmNextOccurrence(user, salary.id)
  assert.equal(movement.kind, 'income')
  assert.equal(movement.sourceActorId, employer.id)
  assert.equal(movement.targetAccountId, account.id)
})
