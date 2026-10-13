import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { commitmentShares, openClaims } from '../src/services/advances.ts'
import {
  changeAmount,
  confirmNextOccurrence,
  createSubscription,
  editCommitment,
  listCommitments,
} from '../src/services/commitments.ts'
import { refundShare } from '../src/services/movements.ts'
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
    refundShares: [{ debtorActorId: employer.id, amount: 40 }],
  })
  return { account, transit, employer, pass }
}

const code = (expected: string) => (err: unknown) => (err as DomainError).code === expected

/** The shares an occurrence was confirmed with, by debtor. */
async function sharesOn(user: string, movementId: string) {
  const claims = await openClaims(user)
  return claims
    .filter((c) => c.movement?.id === movementId)
    .map((c) => [c.share.debtorActorId, c.share.amount])
}

test('a confirmed occurrence of a partly refunded subscription is an advance on that share', async () => {
  const user = await seedUser()
  const { pass, employer, account } = await fixture(user)

  const { movement } = await confirmNextOccurrence(user, pass.id)

  assert.equal(movement.amount, '80.00')
  assert.deepEqual(await sharesOn(user, movement.id), [[employer.id, '40.00']])

  // The refund is the advance's own, nothing specific to a subscription.
  const [claim] = await openClaims(user)
  const refund = await refundShare(user, claim!.share.id)
  assert.equal(refund.amount, '40.00')
  assert.equal(refund.targetAccountId, account.id)
  assert.equal((await openClaims(user)).length, 0)
})

test('a subscription shared by several people gives each occurrence one share per person', async () => {
  const user = await seedUser()
  const { pass, employer } = await fixture(user)
  const flatmate = await createActor(user, { name: 'Flatmate' })

  await editCommitment(user, pass.id, {
    refundShares: [
      { debtorActorId: employer.id, amount: 40, perOccurrence: true },
      { debtorActorId: flatmate.id, amount: 20, perOccurrence: true },
    ],
  })
  const { movement } = await confirmNextOccurrence(user, pass.id)
  assert.deepEqual(await sharesOn(user, movement.id), [
    [employer.id, '40.00'],
    [flatmate.id, '20.00'],
  ])
  // The rule itself is never awaited: only its occurrences are.
  assert.equal((await openClaims(user)).length, 2)
  const [listed] = await listCommitments(user)
  assert.equal(listed!.refundEur, '60.00')
})

test('the shares are stated with their debtor and never exceed the price', async () => {
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
    createSubscription(user, { ...base, refundShares: [{ debtorActorId: employer.id, amount: 31 }] }),
    code('advance_amount_too_large'),
  )
  await assert.rejects(
    createSubscription(user, {
      ...base,
      direction: 'incoming',
      refundShares: [{ debtorActorId: employer.id, amount: 10 }],
    }),
    code('advance_is_expense'),
  )
  await assert.rejects(
    editCommitment(user, pass.id, {
      refundShares: [{ debtorActorId: employer.id, amount: 81, perOccurrence: true }],
    }),
    code('advance_amount_too_large'),
  )
  // A subscription has no total: its shares are per occurrence.
  await assert.rejects(
    editCommitment(user, pass.id, {
      refundShares: [{ debtorActorId: employer.id, amount: 40, perOccurrence: false }],
    }),
    code('claim_needs_financing'),
  )
})

test('a price change keeps the shares, and refuses to fall below them', async () => {
  const user = await seedUser()
  const { pass } = await fixture(user)

  await changeAmount(user, pass.id, 90)
  const [share] = await commitmentShares(user, [pass.id])
  assert.equal(share!.amount, '40.00')
  await assert.rejects(changeAmount(user, pass.id, 35), code('refund_share_above_price'))
  await assert.rejects(
    changeAmount(user, pass.id, 90, undefined, { currency: 'USD' }),
    code('refund_share_keeps_currency'),
  )
})

test('editing the shares applies to the next occurrences, dropping them drops the claim', async () => {
  const user = await seedUser()
  const { pass, employer } = await fixture(user)
  const first = (await confirmNextOccurrence(user, pass.id)).movement

  await editCommitment(user, pass.id, {
    refundShares: [{ debtorActorId: employer.id, amount: 20, perOccurrence: true }],
  })
  const second = (await confirmNextOccurrence(user, pass.id)).movement
  assert.deepEqual(await sharesOn(user, second.id), [[employer.id, '20.00']])

  await editCommitment(user, pass.id, { refundShares: null })
  assert.deepEqual(await commitmentShares(user, [pass.id]), [])
  const third = (await confirmNextOccurrence(user, pass.id)).movement
  assert.deepEqual(await sharesOn(user, third.id), [])

  // What was already confirmed keeps the claim it was written with.
  assert.deepEqual(await sharesOn(user, first.id), [[employer.id, '40.00']])
})
