import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { claimState } from '../src/domain/advance.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { closeShare } from '../src/services/advances.ts'
import { declareMovement, listMovements, refundShare, selectionTotals } from '../src/services/movements.ts'
import { seedUser, setupDb, shareOf, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** Four advances, one per way a claim can stand, owed by two people. */
async function claims() {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const alex = await createActor(user, { name: 'Alex' })
  const employer = await createActor(user, { name: 'Employer' })
  const advance = (happenedOn: string, debtor: string, share: number) =>
    declareMovement(user, {
      happenedOn,
      amount: 80,
      sourceAccountId: account.id,
      targetActorId: restaurant.id,
      refundShares: [{ debtorActorId: debtor, amount: share }],
    })

  const open = await advance('2026-08-01', alex.id, 60)
  await refundShare(user, await shareOf(open.id), { amount: 20, on: '2026-08-05' })

  const settled = await advance('2026-08-10', employer.id, 40)
  await refundShare(user, await shareOf(settled.id), { amount: 15, on: '2026-08-20' })
  await refundShare(user, await shareOf(settled.id), { amount: 25, on: '2026-09-03' })

  const writtenOff = await advance('2026-08-15', alex.id, 50)
  await refundShare(user, await shareOf(writtenOff.id), { amount: 10, on: '2026-08-16' })
  await closeShare(user, await shareOf(writtenOff.id))

  // Closed after it was back in full: the money came back, so it is settled.
  const settledThenClosed = await advance('2026-09-01', employer.id, 30)
  await refundShare(user, await shareOf(settledThenClosed.id), { on: '2026-09-02' })
  await closeShare(user, await shareOf(settledThenClosed.id))

  return { user, alex, employer, open, settled, writtenOff, settledThenClosed }
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()

test('the list keeps advances in each state of their claim', async () => {
  const c = await claims()

  assert.deepEqual(ids(await listMovements(c.user, { advances: 'open' })), [c.open.id])
  assert.deepEqual(
    ids(await listMovements(c.user, { advances: 'settled' })),
    [c.settled.id, c.settledThenClosed.id].sort(),
  )
  assert.deepEqual(ids(await listMovements(c.user, { advances: 'written_off' })), [c.writtenOff.id])
})

test('a listed advance carries what came back and when, and reads its own state', async () => {
  const c = await claims()
  const rows = await listMovements(c.user, { advances: 'settled' })
  const settled = rows.find((m) => m.id === c.settled.id)!
  assert.equal(settled.refunded, '40.00')
  assert.equal(settled.lastRefundedOn, '2026-09-03')

  const all = await listMovements(c.user, { kind: 'expense' })
  const state = new Map(all.map((m) => [m.id, claimState(m)]))
  assert.equal(state.get(c.open.id), 'open')
  assert.equal(state.get(c.settled.id), 'settled')
  assert.equal(state.get(c.writtenOff.id), 'written_off')
  assert.equal(state.get(c.settledThenClosed.id), 'settled')

  // A refund is no advance: nothing to sum on it.
  const [refund] = await listMovements(c.user, { advances: 'refunds', limit: 1 })
  assert.equal(refund!.refunded, null)
  assert.equal(claimState(refund!), null)
})

test('an advance is selected on the day it was paid, a refund on the day it came back', async () => {
  const c = await claims()
  const september = { from: '2026-09-01', to: '2026-09-30' }

  // The advance of August 10th, back in full on September 3rd, is an August advance.
  assert.deepEqual(ids(await listMovements(c.user, { ...september, advances: 'settled' })), [
    c.settledThenClosed.id,
  ])

  // What the employer paid back in September: both refunds landed then.
  const refunds = await listMovements(c.user, { ...september, advances: 'refunds', actorId: c.employer.id })
  assert.deepEqual(refunds.map((r) => [r.happenedOn, r.amount, r.refundsMovementId]).sort(), [
    ['2026-09-02', '30.00', c.settledThenClosed.id],
    ['2026-09-03', '25.00', c.settled.id],
  ])
  const totals = await selectionTotals(c.user, { ...september, advances: 'refunds', actorId: c.employer.id })
  assert.equal(totals.count, '2')
  assert.equal(totals.income, '55.00')
})
