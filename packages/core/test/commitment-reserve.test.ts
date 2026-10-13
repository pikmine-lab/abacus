import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { openClaims } from '../src/services/advances.ts'
import {
  cancelCommitment,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  listCommitmentsWithProgress,
} from '../src/services/commitments.ts'
import { correctMovement, declareMovement, listMovements, refundShare } from '../src/services/movements.ts'
import { flowTotals } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

const code = (expected: string) => (err: unknown) => (err as DomainError).code === expected

async function fixture(refundShares: { debtorActorId: string; amount: number }[] = []) {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const gym = await createActor(user, { name: 'Gym' })
  const parent = await createActor(user, { name: 'Parent' })
  const employer = await createActor(user, { name: 'Employer' })
  const membership = await createSubscription(user, {
    label: 'Gym membership',
    actorId: gym.id,
    accountId: account.id,
    amount: 79,
    periodUnit: 'month',
    firstDueOn: '2026-01-05',
    refundShares: refundShares.map((s) => ({ ...s, debtorActorId: s.debtorActorId || employer.id })),
  })
  const received = (amount: number, on: string, commitmentId = membership.id) =>
    declareMovement(user, {
      happenedOn: on,
      amount,
      sourceActorId: parent.id,
      targetAccountId: account.id,
      reservesCommitmentId: commitmentId,
    })
  const confirm = async (times: number, commitmentId = membership.id) => {
    const ids: string[] = []
    for (let i = 0; i < times; i++) ids.push((await confirmNextOccurrence(user, commitmentId)).movement.id)
    return ids
  }
  return { user, account, gym, parent, employer, membership, received, confirm }
}

/** What each movement drew from a reserve, by id. */
async function drawnOn(user: string, ids: string[]) {
  const rows = await listMovements(user, { limit: 500 })
  return ids.map((id) => rows.find((m) => m.id === id)?.drawn ?? null)
}

async function reserveOf(user: string, commitmentId: string) {
  return (await listCommitmentsWithProgress(user, false)).find((c) => c.id === commitmentId)!.reserve
}

test('each occurrence draws its whole amount from the reserve, and the last one what is left', async () => {
  const { user, received, confirm, membership } = await fixture()
  await received(400, '2026-01-02')
  const months = await confirm(7)

  assert.deepEqual(await drawnOn(user, months), ['79.00', '79.00', '79.00', '79.00', '79.00', '5.00', null])
  assert.deepEqual(await reserveOf(user, membership.id), {
    commitmentId: membership.id,
    received: '400.00',
    drawn: '400.00',
    remaining: '0.00',
    releasedOn: null,
  })
  // Covered months read at zero, the money received is no income.
  const january = await flowTotals(user, '2026-01-01', '2026-01-31')
  assert.equal(january.expenseGross, '79.00')
  assert.equal(january.expenseNet, '0.00')
  assert.equal(january.income, '0.00')
  assert.equal((await flowTotals(user, '2026-06-01', '2026-06-30')).expenseNet, '74.00')
})

test('the reserve comes after the share refunded per occurrence, and gives back what that refund frees', async () => {
  const { user, received, confirm, membership } = await fixture([{ debtorActorId: '', amount: 39.5 }])
  await received(400, '2026-01-02')
  const [january] = await confirm(1)

  // Nothing came back from the employer yet: the whole occurrence is drawn.
  assert.deepEqual(await drawnOn(user, [january!]), ['79.00'])
  assert.equal((await reserveOf(user, membership.id))!.remaining, '321.00')

  const [claim] = await openClaims(user)
  await refundShare(user, claim!.share.id, { on: '2026-01-20' })

  assert.deepEqual(await drawnOn(user, [january!]), ['39.50'])
  assert.equal((await reserveOf(user, membership.id))!.remaining, '360.50')
  assert.equal((await flowTotals(user, '2026-01-01', '2026-01-31')).expenseNet, '0.00')
})

test('an occurrence of a subscription only draws from money arrived on its day', async () => {
  const { user, received, confirm } = await fixture()
  await received(100, '2026-01-02')
  const before = await confirm(3) // January, February, March
  await received(200, '2026-03-20')
  const afterwards = await confirm(1) // April

  // March went without: the top-up does not reach back to it.
  assert.deepEqual(await drawnOn(user, [...before, ...afterwards]), ['79.00', '21.00', null, '79.00'])
})

test('a financing draws from its whole reserve, whenever the money came', async () => {
  const { user, account, gym, received } = await fixture()
  const bike = await createFinancing(user, {
    label: 'Bike',
    actorId: gym.id,
    accountId: account.id,
    installmentsTotal: 3,
    totalAmount: 300,
    firstDueOn: '2026-02-01',
  })
  const paid = []
  for (let i = 0; i < 2; i++) paid.push((await confirmNextOccurrence(user, bike.id)).movement.id)
  await received(150, '2026-05-01', bike.id)

  assert.deepEqual(await drawnOn(user, paid), ['100.00', '50.00'])
})

test('what is left becomes an income on the day the commitment ends, and not before', async () => {
  const { user, received, confirm, membership } = await fixture()
  await received(100, '2026-01-02')
  await received(150, '2026-02-15')
  await confirm(2)

  assert.equal((await flowTotals(user, '2026-01-01', '2026-12-31')).income, '0.00')

  await cancelCommitment(user, membership.id, '2026-03-10')
  const reserve = await reserveOf(user, membership.id)
  // February drew the 21 left of January's money: the 150 came after it.
  assert.equal(reserve!.remaining, '150.00')
  assert.equal(reserve!.releasedOn, '2026-03-10')
  // The income of the cancellation month, nowhere else.
  assert.equal((await flowTotals(user, '2026-02-01', '2026-02-28')).income, '0.00')
  const march = await flowTotals(user, '2026-03-01', '2026-03-31')
  assert.equal(march.income, '150.00')
  assert.equal(march.incomeCount, '1')
  assert.equal((await flowTotals(user, '2026-03-01', '2026-03-31', 'accrual')).income, '150.00')
})

test('a financing paid off releases what its reserve holds beyond what it cost', async () => {
  const { user, account, gym, received } = await fixture()
  const bike = await createFinancing(user, {
    label: 'Bike',
    actorId: gym.id,
    accountId: account.id,
    installmentsTotal: 2,
    totalAmount: 200,
    firstDueOn: '2026-02-01',
  })
  await received(250, '2026-01-15', bike.id)
  await confirmNextOccurrence(user, bike.id)
  assert.equal((await flowTotals(user, '2026-01-01', '2026-12-31')).income, '0.00')
  await confirmNextOccurrence(user, bike.id)

  assert.equal((await reserveOf(user, bike.id))!.releasedOn, '2026-03-01')
  assert.equal((await flowTotals(user, '2026-03-01', '2026-03-31')).income, '50.00')
})

test('only an income feeds a reserve, of an expense commitment still running', async () => {
  const { user, account, gym, parent, membership, received } = await fixture()
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-01-02',
      amount: 10,
      sourceAccountId: account.id,
      targetActorId: gym.id,
      reservesCommitmentId: membership.id,
    }),
    code('reserve_is_income'),
  )
  const salary = await createSubscription(user, {
    label: 'Salary',
    actorId: parent.id,
    accountId: account.id,
    amount: 1000,
    direction: 'incoming',
    periodUnit: 'month',
    firstDueOn: '2026-01-31',
  })
  await assert.rejects(received(10, '2026-01-02', salary.id), code('reserve_needs_expense'))

  const fed = await received(100, '2026-01-02')
  await cancelCommitment(user, membership.id, '2026-01-10')
  await assert.rejects(received(10, '2026-01-12'), code('commitment_over'))
  // Linked before it ended, an income keeps its link through a correction.
  await correctMovement(user, fed.id, { note: 'From my parents' })
  assert.equal((await reserveOf(user, membership.id))!.remaining, '100.00')
})

test('unlinked, money received for a commitment is a plain income again', async () => {
  const { user, received, confirm, membership } = await fixture()
  const fed = await received(100, '2026-01-02')
  const [january] = await confirm(1)

  const plain = await correctMovement(user, fed.id, { reservesCommitmentId: null })

  assert.equal(plain.reservesCommitmentId, null)
  assert.deepEqual(await drawnOn(user, [january!]), [null])
  assert.equal(await reserveOf(user, membership.id), null)
  assert.equal((await flowTotals(user, '2026-01-01', '2026-01-31')).income, '100.00')
})
