import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { debitDateOf } from '../src/domain/card.ts'
import type { DomainError } from '../src/domain/errors.ts'
import { addPeriod, today } from '../src/domain/period.ts'
import type { DayShift } from '../src/domain/types.ts'
import { closeAccount, createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { recordBalanceCheck } from '../src/services/balanceChecks.ts'
import {
  cardStatements,
  confirmStatement,
  createCard,
  deleteCard,
  editCard,
  listCards,
} from '../src/services/cards.ts'
import { closeActivity, createActivity } from '../src/services/catalog.ts'
import {
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  editCommitment,
  financingSchedule,
  moveAccount,
} from '../src/services/commitments.ts'
import { correctMovement, declareMovement, deleteMovement, listMovements } from '../src/services/movements.ts'
import { flowTotals } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

function schedule(statementDay: number, statementShift: DayShift, debitDay: number, debitShift: DayShift) {
  return { statementDay, statementShift, debitDay, debitShift }
}

async function seedLedger() {
  const user = await seedUser()
  const checking = await createAccount({
    userId: user,
    name: 'Checking',
    behavior: 'payment',
    openingBalance: 1000,
    openedOn: '2026-01-01',
  })
  const shop = await createActor(user, { name: 'Shop' })
  return { user, checking, shop }
}

/** Cut off on the 25th, debited on the last working day of the month. */
async function deferredCard(user: string, accountId: string) {
  return await createCard(user, {
    name: 'Gold',
    accountId,
    expiryMonth: '2029-09',
    debitMode: 'deferred',
    ...schedule(25, 'none', 31, 'previous'),
  })
}

test('the debit day follows the cut-off that closes the purchase cycle', () => {
  const endOfMonth = schedule(25, 'none', 31, 'none')
  assert.equal(debitDateOf(endOfMonth, '2026-09-10'), '2026-09-30')
  // Bought on the cut-off day, it still belongs to that cycle.
  assert.equal(debitDateOf(endOfMonth, '2026-09-25'), '2026-09-30')
  assert.equal(debitDateOf(endOfMonth, '2026-09-26'), '2026-10-31')
  // 31 reads "end of month" in a short month too.
  assert.equal(debitDateOf(schedule(31, 'none', 31, 'none'), '2027-02-10'), '2027-02-28')
})

test('each scheduled day moves off a weekend its own way', () => {
  // October 31st, 2026 is a Saturday: a last-working-day debit comes on Friday.
  assert.equal(debitDateOf(schedule(25, 'none', 31, 'previous'), '2026-09-26'), '2026-10-30')
  // Cut off at the end of the month, debited on the first working day of the next.
  const nextMonth = schedule(31, 'none', 1, 'next')
  assert.equal(debitDateOf(nextMonth, '2026-09-30'), '2026-10-01')
  // November 1st, 2026 is a Sunday.
  assert.equal(debitDateOf(nextMonth, '2026-10-15'), '2026-11-02')
  // June 20th, 2026 is a Saturday: the cut-off moves to Monday the 22nd, so a
  // purchase on the Sunday still closes with it.
  assert.equal(debitDateOf(schedule(20, 'next', 30, 'previous'), '2026-06-21'), '2026-06-30')
  // January 31st, 2026 is a Saturday: its cut-off lands on February 2nd, and
  // closes the cycle of a purchase made on February 1st.
  assert.equal(debitDateOf(schedule(31, 'next', 2, 'none'), '2026-02-01'), '2026-02-02')
})

test('a deferred purchase leaves the balance untouched until its statement is debited, and no check in between reports a gap', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)

  // Bought after the January cut-off: expected on the last working day of
  // February, Friday the 27th (the 28th is a Saturday).
  const purchase = await declareMovement(user, {
    happenedOn: '2026-01-26',
    amount: 120,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(purchase.purchasedOn, '2026-01-26')
  assert.equal(purchase.happenedOn, '2026-02-27')
  assert.equal(purchase.cardId, card.id)
  assert.ok(purchase.cardStatementId)

  const between = await recordBalanceCheck(user, checking.id, 1000, '2026-02-10')
  assert.equal(between.gap, 0)
  // Past the expected day, still nothing has left the account as far as the ledger knows.
  const pastExpected = await recordBalanceCheck(user, checking.id, 1000, '2026-03-02')
  assert.equal(pastExpected.gap, 0)

  // The bank debited it on Thursday the 26th: stating it moves the purchase there.
  await confirmStatement(user, purchase.cardStatementId!, '2026-02-26')
  const [moved] = await listMovements(user, {})
  assert.equal(moved!.happenedOn, '2026-02-26')
  const afterDebit = await recordBalanceCheck(user, checking.id, 880, '2026-02-26')
  assert.equal(afterDebit.gap, 0)
})

test('stating the debit moves every purchase of the cycle, and only a day the bank can have debited it', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const first = await declareMovement(user, {
    happenedOn: '2026-06-27',
    amount: 30,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  const second = await declareMovement(user, {
    happenedOn: '2026-07-20',
    amount: 45,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(first.cardStatementId, second.cardStatementId)

  const [pending] = (await listCards(user))[0]!.pending
  assert.equal(pending!.dueOn, '2026-07-31')
  assert.equal(pending!.amount, '75.00')
  assert.equal(pending!.purchases, 2)

  await assert.rejects(
    confirmStatement(user, pending!.id, '2026-07-24'),
    (e: DomainError) => e.code === 'statement_debit_before_cut_off',
  )
  await assert.rejects(
    confirmStatement(user, pending!.id, addPeriod(today(), 'week', 1)),
    (e: DomainError) => e.code === 'statement_debit_ahead',
  )

  const confirmed = await confirmStatement(user, pending!.id, '2026-08-03')
  assert.equal(confirmed.debitedOn, '2026-08-03')
  const dates = (await listMovements(user, {})).map((m) => m.happenedOn)
  assert.deepEqual(dates, ['2026-08-03', '2026-08-03'])
  assert.equal((await listCards(user))[0]!.pending.length, 0)
  assert.equal((await cardStatements(user, card.id))[0]!.debitedOn, '2026-08-03')

  // Taken back: the purchases wait again on the expected day, off the balances.
  await confirmStatement(user, pending!.id, null)
  assert.deepEqual(
    (await listMovements(user, {})).map((m) => m.happenedOn),
    ['2026-07-31', '2026-07-31'],
  )
  assert.equal((await recordBalanceCheck(user, checking.id, 1000, '2026-08-04')).gap, 0)
})

test('a statement left with no purchase goes', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const purchase = await declareMovement(user, {
    happenedOn: '2026-09-20',
    amount: 45,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  await correctMovement(user, purchase.id, { happenedOn: '2026-09-27' })
  const statements = await cardStatements(user, card.id)
  assert.deepEqual(
    statements.map((s) => s.cutOffOn),
    ['2026-10-25'],
  )
  await deleteMovement(user, purchase.id)
  assert.equal((await cardStatements(user, card.id)).length, 0)
})

test('a deferred purchase counts in the month it was bought when read by the month it is about', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  await declareMovement(user, {
    happenedOn: '2026-09-26',
    amount: 120,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })

  assert.equal((await flowTotals(user, '2026-09-01', '2026-09-30', 'accrual')).expenseGross, '120.00')
  assert.equal((await flowTotals(user, '2026-09-01', '2026-09-30')).expenseGross, '0.00')
  assert.equal((await flowTotals(user, '2026-10-01', '2026-10-31')).expenseGross, '120.00')
})

test('an account balance stops at today, and the card says what it will take', async () => {
  const { user, checking, shop } = await seedLedger()
  // Cut off on the 28th, debited on the 5th: the debit always comes after today.
  const card = await createCard(user, {
    name: 'Gold',
    accountId: checking.id,
    expiryMonth: addPeriod(today(), 'year', 3).slice(0, 7),
    debitMode: 'deferred',
    ...schedule(28, 'none', 5, 'none'),
  })
  const purchase = await declareMovement(user, {
    happenedOn: today(),
    amount: 60,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.ok(purchase.happenedOn > today())

  const [account] = await listAccounts(user)
  assert.equal(account!.balance, '1000.00')
  const [listed] = await listCards(user)
  assert.deepEqual(
    listed!.pending.map((s) => ({ dueOn: s.dueOn, amount: s.amount })),
    [{ dueOn: purchase.happenedOn, amount: '60.00' }],
  )
})

test('a deferred purchase belongs to the activity it was bought under, and says whether its debit is stated', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  // Closed at the end of June: a purchase of the 26th is debited on July
  // 31st, after the close, and still belongs to it.
  const activity = await createActivity(user, { name: 'Side project' })
  await closeActivity(user, activity.id, '2026-06-30')
  const purchase = await declareMovement(user, {
    happenedOn: '2026-06-26',
    amount: 40,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    activityId: activity.id,
    cardId: card.id,
  })
  assert.equal(purchase.happenedOn, '2026-07-31')
  assert.equal(purchase.activityId, activity.id)
  assert.equal(purchase.awaitingDebit, true)
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-07-01',
      amount: 40,
      sourceAccountId: checking.id,
      targetActorId: shop.id,
      activityId: activity.id,
      cardId: card.id,
    }),
    (e: DomainError) => e.code === 'activity_closed',
  )

  // Declared after its statement was validated, it is already in the balance.
  await confirmStatement(user, purchase.cardStatementId!, '2026-07-31')
  const late = await declareMovement(user, {
    happenedOn: '2026-07-02',
    amount: 10,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(late.happenedOn, '2026-07-31')
  assert.equal(late.awaitingDebit, false)
})

test('an immediate card dates the purchase on its day', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await createCard(user, {
    name: 'Debit',
    accountId: checking.id,
    expiryMonth: '2029-09',
    debitMode: 'immediate',
  })
  const movement = await declareMovement(user, {
    happenedOn: '2026-09-26',
    amount: 20,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(movement.happenedOn, '2026-09-26')
  assert.equal(movement.purchasedOn, null)
  assert.equal(movement.cardId, card.id)
})

test('a card only pays from its own account, never a transfer, and not after it expired', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const other = await createAccount({ userId: user, name: 'Other', behavior: 'payment' })

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-09-26',
      amount: 20,
      sourceAccountId: other.id,
      targetActorId: shop.id,
      cardId: card.id,
    }),
    (e: DomainError) => e.code === 'card_other_account',
  )
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-09-26',
      amount: 20,
      sourceAccountId: checking.id,
      targetAccountId: other.id,
      cardId: card.id,
    }),
    (e: DomainError) => e.code === 'transfer_has_no_card',
  )
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2029-10-01',
      amount: 20,
      sourceAccountId: checking.id,
      targetActorId: shop.id,
      cardId: card.id,
    }),
    (e: DomainError) => e.code === 'card_expired',
  )
})

test('a merchant refund comes back through the card, an advance comes back to the account', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const friend = await createActor(user, { name: 'Friend' })

  const merchantRefund = await declareMovement(user, {
    happenedOn: '2026-09-27',
    amount: 15,
    sourceActorId: shop.id,
    targetAccountId: checking.id,
    cardId: card.id,
  })
  assert.equal(merchantRefund.happenedOn, '2026-10-30')

  const advance = await declareMovement(user, {
    happenedOn: '2026-09-26',
    amount: 80,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 40,
    refundedNow: true,
  })
  const [refund] = await listMovements(user, { actorId: friend.id })
  assert.equal(refund!.refundsMovementId, advance.id)
  assert.equal(refund!.cardId, null)
  assert.equal(refund!.happenedOn, '2026-09-26')

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-09-28',
      amount: 40,
      sourceActorId: friend.id,
      targetAccountId: checking.id,
      refundsMovementId: advance.id,
      cardId: card.id,
    }),
    (e: DomainError) => e.code === 'refund_has_no_card',
  )
})

test('a correction re-dates a purchase only when its day or its card changes', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const purchase = await declareMovement(user, {
    happenedOn: '2026-09-20',
    amount: 50,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(purchase.happenedOn, '2026-09-30')

  const moved = await correctMovement(user, purchase.id, { happenedOn: '2026-09-26' })
  assert.equal(moved.purchasedOn, '2026-09-26')
  assert.equal(moved.happenedOn, '2026-10-30')

  const noted = await correctMovement(user, purchase.id, { note: 'shoes' })
  assert.equal(noted.happenedOn, '2026-10-30')

  // Debited directly after all: back on the day it happened.
  const direct = await correctMovement(user, purchase.id, { cardId: null })
  assert.equal(direct.happenedOn, '2026-09-26')
  assert.equal(direct.purchasedOn, null)
  assert.equal(direct.cardId, null)
})

test('a corrected schedule moves the purchases still waiting, never those of a stated debit', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await createCard(user, {
    name: 'Gold',
    accountId: checking.id,
    expiryMonth: addPeriod(today(), 'year', 3).slice(0, 7),
    debitMode: 'deferred',
    ...schedule(28, 'none', 5, 'none'),
  })
  const debited = await declareMovement(user, {
    happenedOn: '2026-01-10',
    amount: 10,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  await confirmStatement(user, debited.cardStatementId!, '2026-02-05')
  const waiting = await declareMovement(user, {
    happenedOn: '2026-03-10',
    amount: 10,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  assert.equal(waiting.happenedOn, '2026-04-05')

  // Debited on the 7th after all: the waiting purchase follows, the stated one stays.
  await editCard(user, card.id, { debitDay: 7 })
  let rows = await listMovements(user, {})
  assert.equal(rows.find((m) => m.id === debited.id)!.happenedOn, '2026-02-05')
  assert.equal(rows.find((m) => m.id === waiting.id)!.happenedOn, '2026-04-07')

  // No longer deferred: the waiting purchase goes back to its own day, off any statement.
  await editCard(user, card.id, { debitMode: 'immediate' })
  rows = await listMovements(user, {})
  const waitingNow = rows.find((m) => m.id === waiting.id)!
  assert.equal(rows.find((m) => m.id === debited.id)!.happenedOn, '2026-02-05')
  assert.equal(waitingNow.happenedOn, '2026-03-10')
  assert.equal(waitingNow.purchasedOn, null)
  assert.equal(waitingNow.cardStatementId, null)
  assert.deepEqual(
    (await cardStatements(user, card.id)).map((s) => s.debitedOn),
    ['2026-02-05'],
  )
})

test('a card is declared on a current account with a whole schedule, and stays while something names it', async () => {
  const { user, checking, shop } = await seedLedger()
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })

  await assert.rejects(
    createCard(user, { name: 'X', accountId: savings.id, expiryMonth: '2029-09', debitMode: 'immediate' }),
    (e: DomainError) => e.code === 'card_needs_payment_account',
  )
  await assert.rejects(
    createCard(user, { name: 'X', accountId: checking.id, expiryMonth: '2029-09', debitMode: 'deferred' }),
    (e: DomainError) => e.code === 'deferred_needs_schedule',
  )
  await assert.rejects(
    createCard(user, {
      name: 'X',
      accountId: checking.id,
      expiryMonth: '2029-09',
      debitMode: 'immediate',
      debitDay: 5,
    }),
    (e: DomainError) => e.code === 'schedule_on_immediate',
  )
  const closed = await createAccount({ userId: user, name: 'Old checking', behavior: 'payment' })
  await closeAccount(user, closed.id, '2026-01-31')
  await assert.rejects(
    createCard(user, { name: 'X', accountId: closed.id, expiryMonth: '2029-09', debitMode: 'immediate' }),
    (e: DomainError) => e.code === 'account_closed',
  )

  const card = await deferredCard(user, checking.id)
  await assert.rejects(deferredCard(user, checking.id), (e: DomainError) => e.code === 'card_exists')
  await declareMovement(user, {
    happenedOn: '2026-09-26',
    amount: 20,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    cardId: card.id,
  })
  const other = await createAccount({ userId: user, name: 'Other', behavior: 'payment' })
  await assert.rejects(
    editCard(user, card.id, { accountId: other.id }),
    (e: DomainError) => e.code === 'card_in_use',
  )
  await assert.rejects(deleteCard(user, card.id), (e: DomainError) => e.code === 'card_in_use')

  const unused = await createCard(user, {
    name: 'Spare',
    accountId: checking.id,
    expiryMonth: '2029-09',
    debitMode: 'immediate',
  })
  await deleteCard(user, unused.id)
  assert.deepEqual(
    (await listCards(user)).map((c) => c.name),
    ['Gold'],
  )
})

test('a subscription billed to a deferred card is confirmed as a purchase on it', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const streaming = await createSubscription(user, {
    label: 'Streaming',
    actorId: shop.id,
    accountId: checking.id,
    amount: 13,
    periodUnit: 'month',
    firstDueOn: '2026-09-26',
    cardId: card.id,
  })
  assert.equal(streaming.cardId, card.id)

  const { movement } = await confirmNextOccurrence(user, streaming.id)
  assert.equal(movement.cardId, card.id)
  assert.equal(movement.purchasedOn, '2026-09-26')
  assert.equal(movement.happenedOn, '2026-10-30')
  assert.equal(movement.accrualMonth, null)
  assert.equal(movement.countedInMonth, '2026-09-01')
})

test('a subscription moved to another account is paid there without its card', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const other = await createAccount({ userId: user, name: 'Other', behavior: 'payment' })
  const streaming = await createSubscription(user, {
    label: 'Streaming',
    actorId: shop.id,
    accountId: checking.id,
    amount: 13,
    periodUnit: 'month',
    firstDueOn: '2026-09-26',
    cardId: card.id,
  })
  await moveAccount(user, streaming.id, other.id, '2026-09-01')

  const { movement } = await confirmNextOccurrence(user, streaming.id)
  assert.equal(movement.sourceAccountId, other.id)
  assert.equal(movement.cardId, null)
  assert.equal(movement.happenedOn, '2026-09-26')
})

test('only an outgoing subscription on the card account is billed to it', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const other = await createAccount({ userId: user, name: 'Other', behavior: 'payment' })
  const base = {
    label: 'Streaming',
    actorId: shop.id,
    amount: 13,
    periodUnit: 'month' as const,
    firstDueOn: '2026-09-26',
    cardId: card.id,
  }

  await assert.rejects(
    createSubscription(user, { ...base, accountId: checking.id, direction: 'incoming' }),
    (e: DomainError) => e.code === 'card_needs_expense',
  )
  await assert.rejects(
    createSubscription(user, { ...base, accountId: other.id }),
    (e: DomainError) => e.code === 'card_other_account',
  )
  const plain = await createSubscription(user, { ...base, cardId: undefined, accountId: checking.id })
  const billed = await editCommitment(user, plain.id, { cardId: card.id })
  assert.equal(billed.cardId, card.id)
  const direct = await editCommitment(user, plain.id, { cardId: null })
  assert.equal(direct.cardId, null)
})

test('a financing charged to a deferred card leaves the account with its statement, and its schedule keeps the day it was charged', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const sofa = await createFinancing(user, {
    label: 'Sofa',
    actorId: shop.id,
    accountId: checking.id,
    totalAmount: 900,
    installmentsTotal: 3,
    firstDueOn: '2026-01-26',
    cardId: card.id,
  })
  assert.equal(sofa.cardId, card.id)

  // Charged after the January cut-off: expected on Friday, February 27th.
  const { movement } = await confirmNextOccurrence(user, sofa.id)
  assert.equal(movement.cardId, card.id)
  assert.equal(movement.purchasedOn, '2026-01-26')
  assert.equal(movement.happenedOn, '2026-02-27')
  assert.equal((await recordBalanceCheck(user, checking.id, 1000, '2026-02-10')).gap, 0)

  const [first] = await financingSchedule(user, sofa.id)
  assert.equal(first!.movementId, movement.id)
  assert.equal(first!.dueOn, '2026-01-26')

  // Stating the debit moves the movement, not the day the installment was charged.
  await confirmStatement(user, movement.cardStatementId!, '2026-02-26')
  assert.equal((await financingSchedule(user, sofa.id))[0]!.dueOn, '2026-01-26')
  assert.equal((await recordBalanceCheck(user, checking.id, 700, '2026-02-26')).gap, 0)
})

test('a financing is charged to a card of its own account, and the card can be set or cleared afterwards', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  const other = await createAccount({ userId: user, name: 'Other', behavior: 'payment' })
  const base = {
    label: 'Sofa',
    actorId: shop.id,
    totalAmount: 900,
    installmentsTotal: 3,
    firstDueOn: '2026-01-26',
  }

  await assert.rejects(
    createFinancing(user, { ...base, accountId: other.id, cardId: card.id }),
    (e: DomainError) => e.code === 'card_other_account',
  )
  const plain = await createFinancing(user, { ...base, accountId: checking.id })
  assert.equal(plain.cardId, null)
  assert.equal((await editCommitment(user, plain.id, { cardId: card.id })).cardId, card.id)
  assert.equal((await editCommitment(user, plain.id, { cardId: null })).cardId, null)
})

test('a deferred purchase abroad converts at the rate of the purchase day', async () => {
  const { user, checking, shop } = await seedLedger()
  const card = await deferredCard(user, checking.id)
  // One close, on the purchase day: the debit day, four weeks later, has none near it.
  const history = async () => [{ quotedOn: '2026-01-02', price: '0.9' }]

  const movement = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 100,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
      cardId: card.id,
    },
    history,
  )
  assert.equal(movement.happenedOn, '2026-01-30')
  assert.equal(movement.amount, '90.00')
})
