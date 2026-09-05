import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import { fiscalYearOf } from '../src/domain/period.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity } from '../src/services/catalog.ts'
import {
  cancelInvoice,
  correctInvoice,
  declareInvoice,
  listInvoices,
  outstandingInvoices,
  remindInvoice,
  settleInvoice,
} from '../src/services/invoices.ts'
import { correctMovement, declareMovement, deleteMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/**
 * The activity's regime and the client's invoicing defaults are set straight
 * in the database: the gestures that write them belong to another slice, and
 * these tests only need the columns to hold values.
 */
async function businessActivity(user: string, name: string, defaultVatRate: number | null = null) {
  const activity = await createActivity(user, { name })
  await db()`
    update activity set kind = 'business', vat_registered = ${defaultVatRate !== null},
      default_vat_rate = ${defaultVatRate}
    where id = ${activity.id}
  `
  return activity
}

async function client(user: string, name: string, rates: { vat?: number; withholding?: number } = {}) {
  const actor = await createActor(user, { name })
  await db()`
    update actor set invoice_vat_rate = ${rates.vat ?? null}, invoice_withholding_rate = ${rates.withholding ?? null}
    where id = ${actor.id}
  `
  return actor
}

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (e: DomainError) => e.code === code)

test('rates come from the client first, then from the activity, and amounts follow the base', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting', 21)
  const withholding = await client(user, 'Domestic Co', { vat: 21, withholding: 15 })
  const abroad = await client(user, 'Abroad Ltd', { vat: 0 })
  const silent = await client(user, 'Silent SA')

  const withheld = await declareInvoice(user, {
    activityId: activity.id,
    actorId: withholding.id,
    issuedOn: '2026-03-01',
    baseAmount: 1000,
  })
  assert.equal(withheld.vatRate, '21.00')
  assert.equal(withheld.vatAmount, '210.00')
  assert.equal(withheld.withholdingRate, '15.00')
  assert.equal(withheld.withholdingAmount, '150.00')
  assert.equal(withheld.totalAmount, '1210.00')
  assert.equal(withheld.receivableAmount, '1060.00')
  assert.equal(withheld.currency, 'EUR')

  // The client says no VAT: its zero beats the activity's 21.
  const exported = await declareInvoice(user, {
    activityId: activity.id,
    actorId: abroad.id,
    issuedOn: '2026-03-02',
    baseAmount: 500,
  })
  assert.equal(exported.vatRate, '0.00')
  assert.equal(exported.vatAmount, '0.00')
  assert.equal(exported.withholdingAmount, '0.00')

  // A client saying nothing takes the activity's rate.
  const defaulted = await declareInvoice(user, {
    activityId: activity.id,
    actorId: silent.id,
    issuedOn: '2026-03-03',
    baseAmount: 333.33,
  })
  assert.equal(defaulted.vatRate, '21.00')
  // 69.9993, rounded to the cent.
  assert.equal(defaulted.vatAmount, '70.00')
})

test('a given rate or amount is the truth, whatever the defaults say', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting', 21)
  const actor = await client(user, 'Client', { vat: 21, withholding: 15 })

  const explicit = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    issuedOn: '2026-03-01',
    baseAmount: 1000,
    vatRate: 10,
    // Written on the invoice with its own rounding: kept as is.
    vatAmount: 100.01,
    withholdingRate: 7,
  })
  assert.equal(explicit.vatRate, '10.00')
  assert.equal(explicit.vatAmount, '100.01')
  assert.equal(explicit.withholdingRate, '7.00')
  assert.equal(explicit.withholdingAmount, '70.00')
  assert.equal(explicit.receivableAmount, '1030.01')

  await rejects(
    declareInvoice(user, {
      activityId: activity.id,
      actorId: actor.id,
      issuedOn: '2026-03-01',
      baseAmount: 0,
    }),
    'bad_amount',
  )
  await rejects(
    declareInvoice(user, {
      activityId: activity.id,
      actorId: actor.id,
      issuedOn: '2026-03-01',
      dueOn: '2026-02-01',
      baseAmount: 100,
    }),
    'due_before_issue',
  )
})

test('only an open business activity issues invoices', async () => {
  const user = await seedUser()
  const personal = await createActivity(user, { name: 'Household' })
  const closed = await businessActivity(user, 'Former')
  await db()`update activity set closed_on = '2026-06-30' where id = ${closed.id}`
  const actor = await client(user, 'Client')

  await rejects(
    declareInvoice(user, {
      activityId: personal.id,
      actorId: actor.id,
      issuedOn: '2026-03-01',
      baseAmount: 100,
    }),
    'activity_not_business',
  )
  await rejects(
    declareInvoice(user, {
      activityId: closed.id,
      actorId: actor.id,
      issuedOn: '2026-07-01',
      baseAmount: 100,
    }),
    'activity_closed',
  )
  // Catching up on history before the closure is still allowed.
  const before = await declareInvoice(user, {
    activityId: closed.id,
    actorId: actor.id,
    issuedOn: '2026-05-15',
    baseAmount: 100,
  })
  assert.equal(before.activityId, closed.id)
})

test('a reference is unique within an activity, case ignored, and free across activities', async () => {
  const user = await seedUser()
  const one = await businessActivity(user, 'One')
  const two = await businessActivity(user, 'Two')
  const actor = await client(user, 'Client')
  const line = (activityId: string, reference: string) => ({
    activityId,
    actorId: actor.id,
    reference,
    issuedOn: '2026-03-01',
    baseAmount: 100,
  })

  await declareInvoice(user, line(one.id, 'F-2026-001'))
  await rejects(declareInvoice(user, line(one.id, 'f-2026-001')), 'invoice_reference_taken')
  await declareInvoice(user, line(two.id, 'F-2026-001'))

  const second = await declareInvoice(user, line(one.id, 'F-2026-002'))
  await rejects(correctInvoice(user, second.id, { reference: 'F-2026-001' }), 'invoice_reference_taken')
})

test('the state is read from the facts: pending, overdue, paid, cancelled', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting')
  const actor = await client(user, 'Client')
  const account = await createAccount({ userId: user, name: 'Business account', behavior: 'payment' })
  const line = (reference: string, dueOn?: string) => ({
    activityId: activity.id,
    actorId: actor.id,
    reference,
    issuedOn: '2026-03-01',
    dueOn,
    baseAmount: 100,
  })

  const late = await declareInvoice(user, line('late', '2026-03-31'))
  await declareInvoice(user, line('soon', '2026-05-31'))
  const open = await declareInvoice(user, line('open'))
  const done = await declareInvoice(user, line('done', '2026-03-15'))
  await settleInvoice(user, done.id, { accountId: account.id, date: '2026-03-10' })
  const dropped = await declareInvoice(user, line('dropped'))
  await cancelInvoice(user, dropped.id, '2026-04-02')

  const on = '2026-04-10'
  const states = Object.fromEntries(
    (await listInvoices(user, { activityId: activity.id, on })).map((i) => [i.reference, i.state]),
  )
  assert.deepEqual(states, {
    late: 'overdue',
    soon: 'pending',
    open: 'pending',
    done: 'paid',
    dropped: 'cancelled',
  })

  // Overdue first, then by due date, the undated last: the work to do, in order.
  const outstanding = await outstandingInvoices(user, activity.id, on)
  assert.deepEqual(
    outstanding.map((i) => i.reference),
    ['late', 'soon', 'open'],
  )
  assert.deepEqual(
    (await listInvoices(user, { activityId: activity.id, state: 'overdue', on })).map((i) => i.id),
    [late.id],
  )
  assert.equal(late.state, 'overdue')
  assert.equal(open.dueOn, null)
})

test('settling writes the income, partial then whole, and refuses beyond the remainder', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting', 21)
  const actor = await client(user, 'Client', { withholding: 15 })
  const account = await createAccount({ userId: user, name: 'Business account', behavior: 'payment' })
  const invoice = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    issuedOn: '2026-03-01',
    baseAmount: 1000,
  })
  assert.equal(invoice.receivableAmount, '1060.00')
  assert.equal(invoice.remainingAmount, '1060.00')

  const first = await settleInvoice(user, invoice.id, {
    accountId: account.id,
    date: '2026-03-20',
    amount: 500,
  })
  assert.equal(first.movement.kind, 'income')
  assert.equal(first.movement.amount, '500.00')
  assert.equal(first.movement.sourceActorId, actor.id)
  assert.equal(first.movement.targetAccountId, account.id)
  assert.equal(first.movement.activityId, activity.id)
  assert.equal(first.movement.invoiceId, invoice.id)
  assert.equal(first.invoice.paidAmount, '500.00')
  assert.equal(first.invoice.remainingAmount, '560.00')
  assert.equal(first.invoice.state, 'pending')

  await rejects(
    settleInvoice(user, invoice.id, { accountId: account.id, date: '2026-03-21', amount: 560.01 }),
    'invoice_overpaid',
  )

  // No amount: the remainder.
  const last = await settleInvoice(user, invoice.id, { accountId: account.id, date: '2026-04-02' })
  assert.equal(last.movement.amount, '560.00')
  assert.equal(last.invoice.state, 'paid')
  assert.equal(last.invoice.remainingAmount, '0.00')
  await rejects(settleInvoice(user, invoice.id, { accountId: account.id }), 'invoice_settled')

  // Two incomes on the account, and the balance says what really landed.
  const incomes = await listMovements(user, { kind: 'income' })
  assert.equal(incomes.length, 2)
  assert.ok(incomes.every((m) => m.invoiceId === invoice.id))
})

test('an income pays an invoice only when everything about it agrees', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting')
  const other = await businessActivity(user, 'Other')
  const actor = await client(user, 'Client')
  const stranger = await client(user, 'Stranger')
  const account = await createAccount({ userId: user, name: 'Business account', behavior: 'payment' })
  const invoice = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    issuedOn: '2026-03-01',
    baseAmount: 1000,
  })
  const income = { happenedOn: '2026-03-15', sourceActorId: actor.id, targetAccountId: account.id }

  await rejects(
    declareMovement(user, { ...income, amount: 100, sourceActorId: stranger.id, invoiceId: invoice.id }),
    'invoice_other_client',
  )
  await rejects(
    declareMovement(user, {
      happenedOn: '2026-03-15',
      amount: 100,
      sourceAccountId: account.id,
      targetActorId: actor.id,
      invoiceId: invoice.id,
    }),
    'invoice_needs_income',
  )
  await rejects(
    declareMovement(user, { ...income, amount: 100, activityId: other.id, invoiceId: invoice.id }),
    'invoice_other_activity',
  )
  await rejects(
    declareMovement(user, { ...income, amount: 1000.01, invoiceId: invoice.id }),
    'invoice_overpaid',
  )
  await rejects(
    declareMovement(user, { ...income, amount: 100, invoiceId: '00000000-0000-0000-0000-000000000000' }),
    'invoice_not_found',
  )

  // Linked from the ledger side: the activity is the invoice's, the client's
  // own sphere notwithstanding.
  const paid = await declareMovement(user, { ...income, amount: 600, invoiceId: invoice.id })
  assert.equal(paid.activityId, activity.id)
  assert.equal((await listInvoices(user, { activityId: activity.id }))[0]!.remainingAmount, '400.00')

  // A correction is measured against the other incomes, not against itself.
  const corrected = await correctMovement(user, paid.id, { amount: 1000 })
  assert.equal(corrected.amount, '1000.00')
  await rejects(correctMovement(user, paid.id, { amount: 1000.5 }), 'invoice_overpaid')
  await rejects(correctMovement(user, paid.id, { sourceActorId: stranger.id }), 'invoice_other_client')
  assert.equal((await listInvoices(user, { activityId: activity.id }))[0]!.state, 'paid')

  // Unlinking or deleting the income reopens the invoice: the state was never stored.
  await correctMovement(user, paid.id, { invoiceId: null })
  assert.equal((await listInvoices(user, { activityId: activity.id }))[0]!.paidAmount, '0.00')
  const relinked = await correctMovement(user, paid.id, { invoiceId: invoice.id })
  assert.equal(relinked.invoiceId, invoice.id)
  await deleteMovement(user, paid.id)
  assert.equal((await listInvoices(user, { activityId: activity.id }))[0]!.state, 'pending')
})

test('cancelling, reminding and correcting respect what has already been paid', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user, 'Consulting', 21)
  const actor = await client(user, 'Client')
  const stranger = await client(user, 'Stranger')
  const account = await createAccount({ userId: user, name: 'Business account', behavior: 'payment' })
  const invoice = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    reference: 'F-1',
    issuedOn: '2026-03-01',
    dueOn: '2026-03-31',
    baseAmount: 1000,
  })

  const reminded = await remindInvoice(user, invoice.id, '2026-04-05')
  assert.equal(reminded.remindedOn, '2026-04-05')

  // Correcting the base recomputes an amount that was not restated; a due
  // date alone leaves the VAT figure as written.
  const rebased = await correctInvoice(user, invoice.id, { baseAmount: 1200 })
  assert.equal(rebased.vatAmount, '252.00')
  const restated = await correctInvoice(user, invoice.id, { vatAmount: 252.4 })
  const redated = await correctInvoice(user, invoice.id, { dueOn: '2026-04-30' })
  assert.equal(restated.vatAmount, '252.40')
  assert.equal(redated.vatAmount, '252.40')
  assert.equal(redated.dueOn, '2026-04-30')

  await settleInvoice(user, invoice.id, { accountId: account.id, date: '2026-04-10', amount: 1000 })
  await rejects(correctInvoice(user, invoice.id, { baseAmount: 500 }), 'invoice_below_payments')
  await rejects(correctInvoice(user, invoice.id, { actorId: stranger.id }), 'invoice_has_payments')
  await rejects(cancelInvoice(user, invoice.id), 'invoice_has_payments')

  const fresh = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    reference: 'F-2',
    issuedOn: '2026-03-02',
    baseAmount: 100,
  })
  const cancelled = await cancelInvoice(user, fresh.id, '2026-04-01')
  assert.equal(cancelled.state, 'cancelled')
  await rejects(cancelInvoice(user, fresh.id), 'invoice_already_cancelled')
  await rejects(remindInvoice(user, fresh.id), 'invoice_not_open')
  await rejects(settleInvoice(user, fresh.id, { accountId: account.id }), 'invoice_cancelled')
  await rejects(
    declareMovement(user, {
      happenedOn: '2026-04-02',
      amount: 50,
      sourceActorId: actor.id,
      targetAccountId: account.id,
      invoiceId: fresh.id,
    }),
    'invoice_cancelled',
  )
  // The partly paid one is still work to do; the cancelled one is not.
  assert.deepEqual(
    (await outstandingInvoices(user, activity.id)).map((i) => i.reference),
    ['F-1'],
  )
})

test('scopes invoices to their user', async () => {
  const user = await seedUser('user-1')
  const other = await seedUser('user-2')
  const activity = await businessActivity(user, 'Consulting')
  const actor = await client(user, 'Client')
  const theirs = await client(other, 'Their client')
  const theirActivity = await businessActivity(other, 'Theirs')

  await rejects(
    declareInvoice(user, {
      activityId: theirActivity.id,
      actorId: actor.id,
      issuedOn: '2026-03-01',
      baseAmount: 1,
    }),
    'activity_not_found',
  )
  await rejects(
    declareInvoice(user, {
      activityId: activity.id,
      actorId: theirs.id,
      issuedOn: '2026-03-01',
      baseAmount: 1,
    }),
    'actor_not_found',
  )
  const mine = await declareInvoice(user, {
    activityId: activity.id,
    actorId: actor.id,
    issuedOn: '2026-03-01',
    baseAmount: 1,
  })
  await rejects(remindInvoice(other, mine.id), 'invoice_not_found')
  assert.equal((await listInvoices(other)).length, 0)
})

test('the fiscal year of a day follows the activity’s opening date', () => {
  assert.deepEqual(fiscalYearOf('2026-09-05', 1, 1), { from: '2026-01-01', to: '2026-12-31' })
  assert.deepEqual(fiscalYearOf('2026-03-05', 4, 6), { from: '2025-04-06', to: '2026-04-05' })
  assert.deepEqual(fiscalYearOf('2026-04-06', 4, 6), { from: '2026-04-06', to: '2027-04-05' })
})
