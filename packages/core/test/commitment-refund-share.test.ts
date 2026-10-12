import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import {
  changeAmount,
  confirmNextOccurrence,
  createSubscription,
  editCommitment,
} from '../src/services/commitments.ts'
import { outstandingAdvances, refundAdvance } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function fixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const transit = await createActor(user, { name: 'Transit' })
  const employer = await createActor(user, { name: 'Employer' })
  const pass = await createSubscription(user, {
    label: 'Transit pass',
    actorId: transit.id,
    accountId: account.id,
    amount: 80,
    periodUnit: 'month',
    firstDueOn: '2026-05-01',
    expectedRefundFromActorId: employer.id,
    expectedRefundAmount: 40,
  })
  return { account, transit, employer, pass }
}

const code = (expected: string) => (err: unknown) => (err as DomainError).code === expected

test('a confirmed occurrence of a partly refunded subscription is an advance on that share', async () => {
  const user = await seedUser()
  const { pass, employer, account } = await fixture(user)

  const { movement } = await confirmNextOccurrence(user, pass.id)

  assert.equal(movement.amount, '80.00')
  assert.equal(movement.expectedRefundFromActorId, employer.id)
  assert.equal(movement.expectedRefundAmount, '40.00')
  const [claim] = await outstandingAdvances(user)
  assert.equal(claim!.id, movement.id)

  // The refund is the advance's own, nothing specific to a subscription.
  const refund = await refundAdvance(user, movement.id)
  assert.equal(refund.amount, '40.00')
  assert.equal(refund.targetAccountId, account.id)
  assert.equal((await outstandingAdvances(user)).length, 0)
})

test('the share is stated with its debtor and never exceeds the price', async () => {
  const user = await seedUser()
  const { pass, employer, transit, account } = await fixture(user)
  const base = {
    label: 'Gym',
    actorId: transit.id,
    accountId: account.id,
    amount: 30,
    periodUnit: 'month' as const,
    firstDueOn: '2026-05-01',
  }

  await assert.rejects(
    createSubscription(user, { ...base, expectedRefundFromActorId: employer.id }),
    code('advance_needs_amount'),
  )
  await assert.rejects(
    createSubscription(user, { ...base, expectedRefundAmount: 10 }),
    code('advance_needs_actor'),
  )
  await assert.rejects(
    createSubscription(user, { ...base, expectedRefundFromActorId: employer.id, expectedRefundAmount: 31 }),
    code('advance_amount_too_large'),
  )
  await assert.rejects(
    createSubscription(user, {
      ...base,
      direction: 'incoming',
      expectedRefundFromActorId: employer.id,
      expectedRefundAmount: 10,
    }),
    code('advance_is_expense'),
  )
  await assert.rejects(
    editCommitment(user, pass.id, { expectedRefundAmount: 81 }),
    code('advance_amount_too_large'),
  )
})

test('a price change keeps the share, and refuses to fall below it', async () => {
  const user = await seedUser()
  const { pass } = await fixture(user)

  const raised = await changeAmount(user, pass.id, 90)
  assert.equal(raised.expectedRefundAmount, '40.00')
  await assert.rejects(changeAmount(user, pass.id, 35), code('refund_share_above_price'))
  await assert.rejects(
    changeAmount(user, pass.id, 90, undefined, { currency: 'USD' }),
    code('refund_share_keeps_currency'),
  )
})

test('editing the share applies to the next occurrences, dropping the debtor drops the claim', async () => {
  const user = await seedUser()
  const { pass } = await fixture(user)
  const first = (await confirmNextOccurrence(user, pass.id)).movement

  const lowered = await editCommitment(user, pass.id, { expectedRefundAmount: 20 })
  assert.equal(lowered.expectedRefundAmount, '20.00')
  assert.equal((await confirmNextOccurrence(user, pass.id)).movement.expectedRefundAmount, '20.00')

  const dropped = await editCommitment(user, pass.id, { expectedRefundFromActorId: null })
  assert.equal(dropped.expectedRefundFromActorId, null)
  assert.equal(dropped.expectedRefundAmount, null)
  const third = (await confirmNextOccurrence(user, pass.id)).movement
  assert.equal(third.expectedRefundFromActorId, null)

  // What was already confirmed keeps the claim it was written with.
  const claims = await outstandingAdvances(user)
  assert.equal(claims.find((c) => c.id === first.id)?.expectedRefundAmount, '40.00')
})
