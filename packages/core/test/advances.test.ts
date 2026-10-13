import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { claimState, financingCoverage } from '../src/domain/advance.ts'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor, mergeActors } from '../src/services/actors.ts'
import {
  closeShare,
  commitmentShares,
  openClaims,
  removeShare,
  setShareSchedule,
} from '../src/services/advances.ts'
import {
  confirmNextOccurrence,
  createFinancing,
  editCommitment,
  reviseSchedule,
} from '../src/services/commitments.ts'
import {
  correctMovement,
  declareMovement,
  deleteMovement,
  listMovements,
  refundShare,
} from '../src/services/movements.ts'
import { flowTotals } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

const code = (expected: string) => (err: unknown) => (err as DomainError).code === expected

async function fixture() {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const restaurant = await createActor(user, { name: 'Restaurant' })
  const lea = await createActor(user, { name: 'Lea' })
  const marc = await createActor(user, { name: 'Marc' })
  const sam = await createActor(user, { name: 'Sam' })
  const bill = (
    amount: number,
    shares: { debtorActorId: string; amount: number }[] = [],
    on = '2026-10-05',
  ) =>
    declareMovement(user, {
      happenedOn: on,
      amount,
      sourceAccountId: account.id,
      targetActorId: restaurant.id,
      refundShares: shares,
    })
  const income = (from: string, amount: number, on = '2026-10-06', link: object = {}) =>
    declareMovement(user, {
      happenedOn: on,
      amount,
      sourceActorId: from,
      targetAccountId: account.id,
      ...link,
    })
  return { user, account, restaurant, lea, marc, sam, bill, income }
}

test('a bill shared by several people is one expense with one share each, paid back separately', async () => {
  const { user, lea, marc, bill } = await fixture()
  const dinner = await bill(90, [
    { debtorActorId: lea.id, amount: 30 },
    { debtorActorId: marc.id, amount: 30 },
  ])

  const claims = await openClaims(user)
  assert.deepEqual(
    claims.map((c) => [c.share.debtorActorId, c.remaining]),
    [
      [lea.id, 30],
      [marc.id, 30],
    ],
  )
  // Lea pays today, Marc later: each share closes on its own.
  await refundShare(user, claims[0]!.share.id, { on: '2026-10-06' })
  const [left] = await openClaims(user)
  assert.equal(left!.share.debtorActorId, marc.id)

  const [row] = await listMovements(user, { advances: 'open' })
  assert.equal(row!.id, dinner.id)
  assert.equal(row!.refunded, '30.00')
  assert.deepEqual(
    row!.shares!.map((s) => [s.debtorActorId, s.refunded]),
    [
      [lea.id, '30.00'],
      [marc.id, '0.00'],
    ],
  )
  // The expense is net of what came back, and of nothing still expected.
  assert.equal((await flowTotals(user, '2026-10-01', '2026-10-31')).expenseNet, '60.00')
})

test('the shares never add up to more than what left the account, nor name a person twice', async () => {
  const { lea, marc, bill } = await fixture()
  await assert.rejects(
    bill(100, [
      { debtorActorId: lea.id, amount: 50 },
      { debtorActorId: marc.id, amount: 70 },
    ]),
    code('advance_amount_too_large'),
  )
  await assert.rejects(
    bill(100, [
      { debtorActorId: lea.id, amount: 20 },
      { debtorActorId: lea.id, amount: 20 },
    ]),
    code('share_debtor_repeated'),
  )
  // Covering it all is valid: the bill was paid entirely for others.
  await bill(100, [
    { debtorActorId: lea.id, amount: 50 },
    { debtorActorId: marc.id, amount: 50 },
  ])
})

test('a claim on a financing splits what came back between what it covered and what waits', () => {
  const claim = (amount: string, refunded: string, perOccurrence = false) => ({
    amount,
    refunded,
    perOccurrence,
  })
  // 1 230 back on a claim of 1 230, one installment of 412.50 paid on 1 650.
  assert.deepEqual(financingCoverage(412.5, 1650, [claim('1230', '1230')]), { covered: 307.5, ahead: 922.5 })
  // The whole of it claimed: what is paid is covered first.
  assert.deepEqual(financingCoverage(100, 300, [claim('300', '150')]), { covered: 100, ahead: 50 })
  assert.deepEqual(financingCoverage(200, 300, [claim('300', '150')]), { covered: 150, ahead: 0 })
  // Shares per installment are not a claim on the total.
  assert.equal(financingCoverage(100, 300, [claim('40', '40', true)]), null)
})

test('the claim state of an expense reads across its shares', () => {
  const share = (amount: string, refunded: string, closed = false) => ({ amount, refunded, closed })
  assert.equal(claimState({ shares: [] }), null)
  assert.equal(claimState({ shares: [share('30', '30'), share('30', '0')] }), 'open')
  assert.equal(claimState({ shares: [share('30', '30'), share('30', '10', true)] }), 'written_off')
  assert.equal(claimState({ shares: [share('30', '30'), share('30', '30', true)] }), 'settled')
})

test('a refund comes from its debtor and never exceeds the share', async () => {
  const { user, lea, marc, bill, income } = await fixture()
  const dinner = await bill(90, [{ debtorActorId: lea.id, amount: 30 }])
  const [claim] = await openClaims(user)

  await assert.rejects(
    income(marc.id, 10, '2026-10-06', { refundsShareId: claim!.share.id }),
    code('refund_other_debtor'),
  )
  await assert.rejects(
    income(lea.id, 31, '2026-10-06', { refundsMovementId: dinner.id }),
    code('refund_above_share'),
  )
  await income(lea.id, 20, '2026-10-06', { refundsMovementId: dinner.id })
  await assert.rejects(
    income(lea.id, 11, '2026-10-07', { refundsMovementId: dinner.id }),
    code('refund_above_share'),
  )
})

test('a refund linked to an expense that owed nothing yet creates the share it pays back', async () => {
  const { user, lea, marc, bill, income } = await fixture()
  const dinner = await bill(90, [{ debtorActorId: lea.id, amount: 30 }])

  // Marc paid before the bill was even declared an advance for him.
  await income(marc.id, 25, '2026-10-04', { refundsMovementId: dinner.id })
  const [row] = await listMovements(user, { advances: 'open' })
  assert.deepEqual(
    row!.shares!.map((s) => [s.debtorActorId, s.amount, s.refunded]),
    [
      [lea.id, '30.00', '0.00'],
      [marc.id, '25.00', '25.00'],
    ],
  )
  // Only within what is left of the bill.
  await assert.rejects(
    income(lea.id, 40, '2026-10-06', { refundsMovementId: (await bill(30)).id }),
    code('advance_amount_too_large'),
  )
})

test('an income already declared is linked afterwards, moved, and unlinked', async () => {
  const { user, lea, bill, income } = await fixture()
  const first = await bill(60, [{ debtorActorId: lea.id, amount: 20 }])
  const second = await bill(40)
  const paid = await income(lea.id, 20)
  assert.equal(paid.refundsShareId, null)

  const linked = await correctMovement(user, paid.id, { refundsMovementId: first.id })
  assert.notEqual(linked.refundsShareId, null)
  assert.deepEqual(await openClaims(user), [])

  // Linked to the wrong bill: moved onto the other, whose share it creates.
  await correctMovement(user, paid.id, { refundsMovementId: second.id })
  const claims = await openClaims(user)
  assert.deepEqual(
    claims.map((c) => [c.movement!.id, c.remaining]),
    [[first.id, 20]],
  )

  // Unlinked, it is a plain income again, counted as one.
  const plain = await correctMovement(user, paid.id, { refundsMovementId: null })
  assert.equal(plain.refundsShareId, null)
  assert.equal((await flowTotals(user, '2026-10-01', '2026-10-31')).income, '20.00')
})

test('dropping a share with refunds turns them back into incomes, by name only', async () => {
  const { user, lea, marc, bill, income } = await fixture()
  const dinner = await bill(90, [
    { debtorActorId: lea.id, amount: 30 },
    { debtorActorId: marc.id, amount: 30 },
  ])
  const refund = await income(lea.id, 30, '2026-10-06', { refundsMovementId: dinner.id })

  // Restating the list cannot drop it silently.
  await assert.rejects(
    correctMovement(user, dinner.id, { refundShares: [{ debtorActorId: marc.id, amount: 30 }] }),
    code('advance_has_refund'),
  )
  const leaShare = (await listMovements(user, { advances: 'open' }))[0]!.shares!.find(
    (s) => s.debtorActorId === lea.id,
  )!
  const detached = await removeShare(user, leaShare.id)
  assert.deepEqual(detached, [refund.id])
  const [after] = await listMovements(user, { actorId: lea.id })
  assert.equal(after!.refundsShareId, null)
  // Deleting the bill is refused while a refund still points at one of its shares.
  await income(marc.id, 10, '2026-10-07', { refundsMovementId: dinner.id })
  await assert.rejects(deleteMovement(user, dinner.id), code('refunded_movement'))
})

test('two people owing on the same bill cannot be merged into one silently', async () => {
  const { user, lea, marc, sam, bill } = await fixture()
  await bill(90, [
    { debtorActorId: lea.id, amount: 30 },
    { debtorActorId: marc.id, amount: 30 },
  ])
  await assert.rejects(mergeActors(user, lea.id, marc.id), code('merge_shares_overlap'))
  await bill(20, [{ debtorActorId: sam.id, amount: 10 }])
  await mergeActors(user, lea.id, sam.id)
  const owed = (await openClaims(user)).filter((c) => c.share.debtorActorId === lea.id)
  assert.equal(owed.length, 2)
})

test('a written-off share stops being awaited, the others stay', async () => {
  const { user, lea, marc, bill } = await fixture()
  await bill(90, [
    { debtorActorId: lea.id, amount: 30 },
    { debtorActorId: marc.id, amount: 30 },
  ])
  const [first] = await openClaims(user)
  await closeShare(user, first!.share.id)
  const left = await openClaims(user)
  assert.deepEqual(
    left.map((c) => c.share.debtorActorId),
    [marc.id],
  )
  assert.equal(claimState((await listMovements(user, { advances: 'open' }))[0]!), 'open')
})

test('a repayment plan says what is next and what is late, against refunds in total', async () => {
  const { user, lea, bill, income } = await fixture()
  const dinner = await bill(90, [{ debtorActorId: lea.id, amount: 60 }], '2026-07-01')
  const [claim] = await openClaims(user)

  await assert.rejects(
    setShareSchedule(user, claim!.share.id, {
      lines: [
        { dueOn: '2026-08-01', amount: 20 },
        { dueOn: '2026-09-01', amount: 20 },
      ],
    }),
    code('schedule_sum_mismatch'),
  )
  const plan = await setShareSchedule(user, claim!.share.id, { count: 3, firstDueOn: '2026-08-01' })
  assert.deepEqual(
    plan.map((l) => [l.dueOn, l.amount]),
    [
      ['2026-08-01', '20.00'],
      ['2026-09-01', '20.00'],
      ['2026-10-01', '20.00'],
    ],
  )

  // Paid 25 so far: the first line is covered, 15 left on the second.
  await income(lea.id, 25, '2026-08-03', { refundsMovementId: dinner.id })
  const [mid] = await openClaims(user, '2026-08-20')
  assert.equal(mid!.nextDueOn, '2026-09-01')
  assert.equal(mid!.nextDueAmount, 15)
  assert.equal(mid!.lateAmount, 0)

  // On October 15th, 60 was expected and 25 came back.
  const [late] = await openClaims(user, '2026-10-15')
  assert.equal(late!.lateAmount, 35)

  // A planned share keeps its amount until the plan is restated.
  await assert.rejects(
    correctMovement(user, dinner.id, { refundShares: [{ debtorActorId: lea.id, amount: 50 }] }),
    code('share_has_schedule'),
  )
  await setShareSchedule(user, claim!.share.id, null)
  const [unplanned] = await openClaims(user, '2026-10-15')
  assert.equal(unplanned!.lateAmount, 0)
  assert.equal(unplanned!.nextDueOn, null)
})

/** An instalment purchase made for someone else: three instalments of 100. */
async function financed() {
  const f = await fixture()
  const shop = await createActor(f.user, { name: 'Shop' })
  const plan = await createFinancing(f.user, {
    label: 'Laptop',
    actorId: shop.id,
    accountId: f.account.id,
    installmentsTotal: 3,
    totalAmount: 300,
    firstDueOn: '2026-07-01',
    refundShares: [{ debtorActorId: f.lea.id, amount: 300, perOccurrence: false }],
  })
  return { ...f, plan }
}

test('a claim on the total of a financing is paid back on its own rhythm, and spread over the instalments paid', async () => {
  const { user, lea, plan, income } = await financed()
  const [claim] = await openClaims(user)
  assert.equal(claim!.commitment!.id, plan.id)
  assert.equal(claim!.remaining, 300)

  await confirmNextOccurrence(user, plan.id)
  await income(lea.id, 50, '2026-07-10', { refundsShareId: claim!.share.id })
  await income(lea.id, 50, '2026-08-10', { refundsShareId: claim!.share.id })
  // July's instalment is back in full, in July: its net is zero.
  assert.equal((await flowTotals(user, '2026-07-01', '2026-07-31')).expenseNet, '0.00')

  // A refund beyond what the paid instalments claim waits for the next one.
  await income(lea.id, 50, '2026-08-20', { refundsShareId: claim!.share.id })
  assert.equal((await flowTotals(user, '2026-07-01', '2026-07-31')).expenseNet, '0.00')
  await confirmNextOccurrence(user, plan.id)
  assert.equal((await flowTotals(user, '2026-08-01', '2026-08-31')).expenseNet, '50.00')

  // The refund is never an income: it is money coming back.
  assert.equal((await flowTotals(user, '2026-07-01', '2026-08-31')).income, '0.00')
  const [left] = await openClaims(user)
  assert.equal(left!.remaining, 150)
  // Refunds land on the financing's account by default.
  const refund = await refundShare(user, claim!.share.id, { amount: 10, on: '2026-09-01' })
  assert.equal(refund.targetAccountId, plan.accountId)
})

test('a refund linked to an instalment pays the claim its sender has on the total', async () => {
  const { user, lea, marc, plan, income } = await financed()
  const { movement } = await confirmNextOccurrence(user, plan.id)
  const [claim] = await openClaims(user)

  // Lea owes on the total: linked to the instalment, the money goes to that claim.
  const paid = await income(lea.id, 100, '2026-07-05', { refundsMovementId: movement.id })
  assert.equal(paid.refundsShareId, claim!.share.id)
  const [after] = await openClaims(user)
  assert.equal(after!.remaining, 200)

  // The claim takes the whole instalment: nobody else can owe a share of it.
  await assert.rejects(
    income(marc.id, 10, '2026-07-06', { refundsMovementId: movement.id }),
    code('advance_amount_too_large'),
  )
})

test('a financing is shared per instalment, on its total, or both, within every instalment', async () => {
  const { user, lea, marc, plan } = await financed()
  await assert.rejects(
    editCommitment(user, plan.id, {
      refundShares: [
        { debtorActorId: lea.id, amount: 200, perOccurrence: false },
        { debtorActorId: marc.id, amount: 101, perOccurrence: false },
      ],
    }),
    code('advance_amount_too_large'),
  )
  // Half the total claims 50 of each instalment of 100: 60 more per instalment is too much.
  await assert.rejects(
    editCommitment(user, plan.id, {
      refundShares: [
        { debtorActorId: lea.id, amount: 150, perOccurrence: false },
        { debtorActorId: marc.id, amount: 60, perOccurrence: true },
      ],
    }),
    code('advance_amount_too_large'),
  )
  await editCommitment(user, plan.id, {
    refundShares: [
      { debtorActorId: lea.id, amount: 150, perOccurrence: false },
      { debtorActorId: marc.id, amount: 40, perOccurrence: true },
    ],
  })
  assert.deepEqual(
    (await commitmentShares(user, [plan.id])).map((s) => [s.debtorActorId, s.amount, s.perOccurrence]),
    [
      [lea.id, '150.00', false],
      [marc.id, '40.00', true],
    ],
  )
  // A plan revised below what others owe of it is refused.
  const lines = [{ dueOn: '2026-07-01', amount: 100 }]
  await assert.rejects(reviseSchedule(user, plan.id, lines), code('advance_amount_too_large'))

  // Every confirmed instalment carries the share per instalment; the claim on
  // the total stays one claim.
  const { movement } = await confirmNextOccurrence(user, plan.id)
  const claims = await openClaims(user)
  const of = (debtor: string) => claims.find((c) => c.share.debtorActorId === debtor)!
  assert.equal(claims.length, 2)
  assert.deepEqual([of(lea.id).commitment!.id, of(lea.id).share.amount], [plan.id, '150.00'])
  assert.deepEqual([of(marc.id).movement!.id, of(marc.id).share.amount], [movement.id, '40.00'])
})

test('an expense declared after its refunds came in links them, creating the shares they pay', async () => {
  const { user, account, restaurant, lea, marc, income } = await fixture()
  const fromLea = await income(lea.id, 30, '2026-10-02')
  const fromMarc = await income(marc.id, 20, '2026-10-03')
  const dinner = await declareMovement(user, {
    happenedOn: '2026-10-05',
    amount: 90,
    sourceAccountId: account.id,
    targetActorId: restaurant.id,
    refundShares: [{ debtorActorId: lea.id, amount: 30 }],
    refundedBy: [fromLea.id, fromMarc.id],
  })
  const [row] = await listMovements(user, { advances: 'settled' })
  assert.equal(row!.id, dinner.id)
  assert.deepEqual(
    row!.shares!.map((s) => [s.debtorActorId, s.amount, s.refunded]),
    [
      [lea.id, '30.00', '30.00'],
      [marc.id, '20.00', '20.00'],
    ],
  )
})
