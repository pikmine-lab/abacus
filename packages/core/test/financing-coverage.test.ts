import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { openClaims } from '../src/services/advances.ts'
import {
  confirmNextOccurrence,
  createFinancing,
  listCommitmentsWithProgress,
} from '../src/services/commitments.ts'
import { declareMovement, refundShare } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** A bike of 400 in two installments, half of it claimed on its total from a parent. */
async function fixture() {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Bike shop' })
  const parent = await createActor(user, { name: 'Parent' })
  const family = await createActor(user, { name: 'Family' })
  const bike = await createFinancing(user, {
    label: 'Bike',
    actorId: shop.id,
    accountId: account.id,
    installmentsTotal: 2,
    totalAmount: 400,
    firstDueOn: '2026-02-01',
    refundShares: [{ debtorActorId: parent.id, amount: 200, perOccurrence: false }],
  })
  const given = (amount: number, on: string) =>
    declareMovement(user, {
      happenedOn: on,
      amount,
      sourceActorId: family.id,
      targetAccountId: account.id,
      reservesCommitmentId: bike.id,
    })
  const refunded = async (amount: number, on: string) => {
    const [claim] = await openClaims(user)
    await refundShare(user, claim!.share.id, { amount, on })
  }
  return { user, bike, given, refunded }
}

async function coverageOf(user: string, commitmentId: string) {
  const c = (await listCommitmentsWithProgress(user, false)).find((x) => x.id === commitmentId)!
  return { coverage: c.progress!.coverage, reserve: c.reserve }
}

/** What every net deducts from the financing's installments, read where the analyses read it. */
async function deductedFrom(commitmentId: string) {
  const [row] = await db()<{ deducted: string }[]>`
    select coalesce(sum(er.refunded), 0)::numeric(14,2) as deducted
    from financing_installment fi
    join expense_refund er on er.movement_id = fi.movement_id
    where fi.commitment_id = ${commitmentId}
  `
  return Number(row!.deducted)
}

test('a refund landing after an installment gives back to the reserve what it covers of it', async () => {
  const { user, bike, given, refunded } = await fixture()
  await given(400, '2026-01-15')
  await confirmNextOccurrence(user, bike.id)

  // Nothing came back yet: the reserve pays the whole installment.
  let read = await coverageOf(user, bike.id)
  assert.equal(read.reserve!.remaining, '200.00')
  assert.deepEqual(read.coverage, { covered: 200, ahead: 200, refunds: { covered: 0, ahead: 0 } })

  // The parent pays back their half of it: the reserve only draws the rest.
  await refunded(100, '2026-02-20')
  read = await coverageOf(user, bike.id)
  assert.equal(read.reserve!.remaining, '300.00')
  assert.deepEqual(read.coverage, { covered: 200, ahead: 300, refunds: { covered: 100, ahead: 0 } })
  assert.equal(read.coverage!.covered, await deductedFrom(bike.id))
})

test('a refund beyond what the paid installments claim waits for the next one', async () => {
  const { user, bike, refunded } = await fixture()
  await confirmNextOccurrence(user, bike.id)
  await refunded(150, '2026-02-20')

  const { coverage } = await coverageOf(user, bike.id)
  assert.deepEqual(coverage, { covered: 100, ahead: 50, refunds: { covered: 100, ahead: 50 } })
  assert.equal(coverage!.covered, await deductedFrom(bike.id))
})

test('once the financing is paid off, what its reserve holds waits for nothing', async () => {
  const { user, bike, given } = await fixture()
  await given(500, '2026-01-15')
  await confirmNextOccurrence(user, bike.id)
  await confirmNextOccurrence(user, bike.id)

  const { coverage, reserve } = await coverageOf(user, bike.id)
  assert.equal(reserve!.remaining, '100.00')
  assert.deepEqual(coverage, { covered: 400, ahead: 0, refunds: { covered: 0, ahead: 0 } })
  assert.equal(coverage!.covered, await deductedFrom(bike.id))
})

test('a financing nobody claimed on or gave money for has nothing covering it', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Bike shop' })
  const bike = await createFinancing(user, {
    label: 'Bike',
    actorId: shop.id,
    accountId: account.id,
    installmentsTotal: 2,
    totalAmount: 400,
    firstDueOn: '2026-02-01',
  })
  await confirmNextOccurrence(user, bike.id)

  assert.equal((await coverageOf(user, bike.id)).coverage, null)
})
