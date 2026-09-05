import { db, type Executor } from '../db/client.ts'
import { getActor } from '../db/datasources/actors.ts'
import { getActivity } from '../db/datasources/catalog.ts'
import {
  getInvoice,
  type InvoiceWithPayments,
  insertInvoice,
  listInvoices as listInvoicesDs,
  paidSoFar,
  updateInvoiceRow,
} from '../db/datasources/invoices.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { Activity, Invoice, Movement } from '../domain/types.ts'
import { declareMovementIn } from './movements.ts'

/**
 * An invoice is what was asked of a client, recorded here after the invoicing
 * tool issued it: abacus numbers nothing, signs nothing, transmits nothing.
 *
 * What declaring guarantees: the invoice belongs to a `business` activity
 * that was still open on its issue date, to a client of this user, and its
 * amounts are the ones written on it. A rate proposes, an amount decides: a
 * rate left out comes from the client (its own VAT and withholding defaults),
 * then from the activity's default VAT; an amount left out is the base times
 * that rate, rounded to the cent; an amount given is kept as is, rounding
 * included. Two invoices of one activity never share a reference.
 *
 * What it refuses: a `personal` activity (it has no clients and no revenue to
 * state), an issue date after the activity closed, a due date before the
 * issue, a reference already used in the activity.
 *
 * The state is never stored, it is read: paid once the linked incomes reach
 * the receivable, overdue when unpaid past its due date, cancelled by its
 * date. Settling writes the income, so the account balance and the balance
 * check keep telling the truth: a flag would not. Partial payments are the
 * ordinary case, an overpayment is refused. Cancelling an invoice that has
 * received money is refused too: the money is a fact, the invoice cannot
 * pretend it was never owed.
 */

export interface DeclareInvoiceInput {
  activityId: string
  actorId: string
  reference?: string
  issuedOn: string
  dueOn?: string
  /** Excluding VAT, in `currency`. */
  baseAmount: number
  /** Percent. Omitted: the client's default, then the activity's. */
  vatRate?: number
  /** Omitted: computed from the rate, rounded to the cent. Given: kept as written. */
  vatAmount?: number
  /** Percent, on the base. Omitted: the client's default, else none. */
  withholdingRate?: number
  withholdingAmount?: number
  /** ISO 4217. Omitted: the activity's currency. */
  currency?: string
  note?: string
}

export type InvoiceState = 'pending' | 'overdue' | 'paid' | 'cancelled'

/** An invoice as both interfaces read it: what was paid, what is left, what it is now. */
export type InvoiceView = Invoice & {
  paidAmount: string
  remainingAmount: string
  state: InvoiceState
}

/** Money arithmetic in cents, so 0.1 + 0.2 never leaks into a stored amount. */
function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function ofRate(base: number, rate: number): number {
  return cents((base * rate) / 100)
}

function checkAmounts(input: {
  baseAmount: number
  vatRate: number
  vatAmount: number
  withholdingRate: number
  withholdingAmount: number
  issuedOn: string
  dueOn?: string | null
}): void {
  if (!(input.baseAmount > 0)) throw new DomainError('bad_amount', 'An invoice base is always positive')
  for (const [name, rate] of [
    ['vatRate', input.vatRate],
    ['withholdingRate', input.withholdingRate],
  ] as const) {
    if (!(rate >= 0 && rate <= 100))
      throw new DomainError('bad_rate', `${name} is a percentage between 0 and 100`)
  }
  if (input.vatAmount < 0 || input.withholdingAmount < 0)
    throw new DomainError('bad_amount', 'VAT and withholding amounts are never negative')
  if (input.withholdingAmount > input.baseAmount + input.vatAmount + 0.005)
    throw new DomainError(
      'withholding_exceeds_total',
      'The withholding cannot exceed what the invoice asks for (base + VAT)',
    )
  if (input.dueOn && input.dueOn < input.issuedOn)
    throw new DomainError('due_before_issue', 'An invoice falls due on or after the day it was issued')
}

async function requireBusinessActivity(
  tx: Executor,
  userId: string,
  activityId: string,
  issuedOn: string,
): Promise<Activity> {
  const activity = await getActivity(tx, userId, activityId)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
  if (activity.kind !== 'business')
    throw new DomainError(
      'activity_not_business',
      `"${activity.name}" is a personal activity: only a business activity issues invoices`,
    )
  if (activity.closedOn && issuedOn > activity.closedOn)
    throw new DomainError('activity_closed', `"${activity.name}" is closed since ${activity.closedOn}`)
  return activity
}

export async function declareInvoice(userId: string, input: DeclareInvoiceInput): Promise<InvoiceView> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const activity = await requireBusinessActivity(tx, userId, input.activityId, input.issuedOn)
    const client = await getActor(tx, userId, input.actorId)
    if (!client) throw new DomainError('actor_not_found', `No actor ${input.actorId} for this user`)

    // The client says what it does to an invoice; the activity only proposes
    // a VAT rate when the client says nothing.
    const vatRate = input.vatRate ?? Number(client.invoiceVatRate ?? activity.defaultVatRate ?? 0)
    const withholdingRate = input.withholdingRate ?? Number(client.invoiceWithholdingRate ?? 0)
    const row = {
      userId,
      activityId: activity.id,
      actorId: client.id,
      reference: input.reference?.trim() || null,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn ?? null,
      currency: (input.currency ?? activity.currency).toUpperCase(),
      baseAmount: cents(input.baseAmount),
      vatRate,
      vatAmount: input.vatAmount !== undefined ? cents(input.vatAmount) : ofRate(input.baseAmount, vatRate),
      withholdingRate,
      withholdingAmount:
        input.withholdingAmount !== undefined
          ? cents(input.withholdingAmount)
          : ofRate(input.baseAmount, withholdingRate),
      note: input.note ?? null,
    }
    checkAmounts(row)
    try {
      return withState(await insertInvoice(tx, row), '0.00')
    } catch (e) {
      rethrowUnique(
        e,
        'invoice_reference_taken',
        `"${row.reference}" already names an invoice of this activity`,
      )
    }
  })
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface CorrectInvoiceInput {
  actorId?: string
  reference?: string | null
  issuedOn?: string
  dueOn?: string | null
  baseAmount?: number
  vatRate?: number
  vatAmount?: number
  withholdingRate?: number
  withholdingAmount?: number
  currency?: string
  note?: string | null
}

/**
 * Corrects what was mistyped. The amounts follow the same rule as on
 * declaration, read against what changes: an amount given is kept as
 * written; one left out is recomputed from the rate when the base or that
 * rate moved, and kept otherwise, so correcting a due date never rewrites a
 * VAT figure that was copied from the invoice.
 *
 * What the linked incomes have already paid is a fact: the receivable cannot
 * drop below it, and the client cannot change while money from the former
 * one is linked. The activity never changes: an invoice of another activity
 * is another invoice.
 */
export async function correctInvoice(
  userId: string,
  id: string,
  input: CorrectInvoiceInput,
): Promise<InvoiceView> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const current = await getInvoice(tx, userId, id)
    if (!current) throw new DomainError('invoice_not_found', `No invoice ${id} for this user`)
    if (input.actorId !== undefined && input.actorId !== current.actorId) {
      const client = await getActor(tx, userId, input.actorId)
      if (!client) throw new DomainError('actor_not_found', `No actor ${input.actorId} for this user`)
    }
    const issuedOn = input.issuedOn ?? current.issuedOn
    await requireBusinessActivity(tx, userId, current.activityId, issuedOn)

    const baseAmount = cents(input.baseAmount ?? Number(current.baseAmount))
    const vatRate = input.vatRate ?? Number(current.vatRate)
    const withholdingRate = input.withholdingRate ?? Number(current.withholdingRate)
    const baseMoved = baseAmount !== Number(current.baseAmount)
    const amountOf = (given: number | undefined, stored: string, rate: number, rateMoved: boolean) =>
      given !== undefined ? cents(given) : baseMoved || rateMoved ? ofRate(baseAmount, rate) : Number(stored)
    const patch = {
      actorId: input.actorId ?? current.actorId,
      reference: input.reference !== undefined ? input.reference?.trim() || null : current.reference,
      issuedOn,
      dueOn: input.dueOn !== undefined ? input.dueOn : current.dueOn,
      currency: (input.currency ?? current.currency).toUpperCase(),
      baseAmount,
      vatRate,
      vatAmount: amountOf(input.vatAmount, current.vatAmount, vatRate, vatRate !== Number(current.vatRate)),
      withholdingRate,
      withholdingAmount: amountOf(
        input.withholdingAmount,
        current.withholdingAmount,
        withholdingRate,
        withholdingRate !== Number(current.withholdingRate),
      ),
      note: input.note !== undefined ? input.note : current.note,
    }
    checkAmounts(patch)

    const paid = Number(await paidSoFar(tx, id))
    if (paid > 0) {
      if (patch.actorId !== current.actorId)
        throw new DomainError(
          'invoice_has_payments',
          'Incomes from this client already pay the invoice: unlink them before changing the client',
        )
      if (patch.currency !== current.currency)
        throw new DomainError(
          'invoice_has_payments',
          'Incomes already pay this invoice in its currency: unlink them before changing it',
        )
      if (patch.baseAmount + patch.vatAmount - patch.withholdingAmount < paid - 0.005)
        throw new DomainError(
          'invoice_below_payments',
          `The receivable cannot drop below the ${paid} already received on this invoice`,
        )
    }
    try {
      const updated = await updateInvoiceRow(tx, userId, id, patch)
      return withState(updated!, paid.toFixed(2))
    } catch (e) {
      rethrowUnique(
        e,
        'invoice_reference_taken',
        `"${patch.reference}" already names an invoice of this activity`,
      )
    }
  })
}

/**
 * The client will never pay this one: the invoice leaves the outstanding list
 * and stays readable, dated. Refused once money is linked to it, because that
 * money says the invoice was owed; the incomes have to be unlinked first.
 */
export async function cancelInvoice(
  userId: string,
  id: string,
  cancelledOn: string = today(),
): Promise<InvoiceView> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const current = await getInvoice(tx, userId, id)
    if (!current) throw new DomainError('invoice_not_found', `No invoice ${id} for this user`)
    if (current.cancelledOn)
      throw new DomainError(
        'invoice_already_cancelled',
        `This invoice was already cancelled on ${current.cancelledOn}`,
      )
    const paid = Number(await paidSoFar(tx, id))
    if (paid > 0)
      throw new DomainError(
        'invoice_has_payments',
        `${paid} has already been received on this invoice: an invoice that was paid, even in part, is not cancelled`,
      )
    const updated = await updateInvoiceRow(tx, userId, id, { cancelledOn })
    return withState(updated!, '0.00')
  })
}

/** The client was reminded: the date is kept so the screen can say how long ago. */
export async function remindInvoice(
  userId: string,
  id: string,
  remindedOn: string = today(),
): Promise<InvoiceView> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const current = await getInvoice(tx, userId, id)
    if (!current) throw new DomainError('invoice_not_found', `No invoice ${id} for this user`)
    const paid = await paidSoFar(tx, id)
    const state = stateOf(current, paid)
    if (state === 'paid' || state === 'cancelled')
      throw new DomainError('invoice_not_open', `This invoice is ${state}: there is nothing left to remind`)
    const updated = await updateInvoiceRow(tx, userId, id, { remindedOn })
    return withState(updated!, paid)
  })
}

/**
 * The money arrived: writes the income that pays the invoice, in full or in
 * part, in the same transaction. Everything the movement needs is on the
 * invoice (the client, the activity, the currency); the caller only says what
 * reality added, the account it landed on, the day, and the amount when it
 * is not the whole remainder.
 */
export async function settleInvoice(
  userId: string,
  id: string,
  { amount, date, accountId }: { amount?: number; date?: string; accountId: string },
): Promise<{ movement: Movement; invoice: InvoiceView }> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const invoice = await getInvoice(tx, userId, id)
    if (!invoice) throw new DomainError('invoice_not_found', `No invoice ${id} for this user`)
    if (invoice.cancelledOn)
      throw new DomainError('invoice_cancelled', `This invoice was cancelled on ${invoice.cancelledOn}`)
    const remaining = cents(Number(invoice.receivableAmount) - Number(await paidSoFar(tx, id)))
    if (!(remaining > 0)) throw new DomainError('invoice_settled', 'This invoice is already paid in full')
    const received = amount ?? remaining
    if (!(received > 0)) throw new DomainError('bad_amount', 'An amount is always positive')
    const movement = await declareMovementIn(tx, userId, {
      happenedOn: date ?? today(),
      amount: received,
      currency: invoice.currency,
      sourceActorId: invoice.actorId,
      targetAccountId: accountId,
      activityId: invoice.activityId,
      invoiceId: invoice.id,
    })
    return { movement, invoice: withState(invoice, await paidSoFar(tx, id)) }
  })
}

/**
 * The state, read from the facts rather than stored: cancelled by its date,
 * paid once the linked incomes reach the receivable, overdue when unpaid
 * past its due date, pending otherwise. An invoice with nothing to receive
 * (a withholding that eats the whole total) counts as paid on issue.
 */
export function stateOf(invoice: Invoice, paid: string | number, on: string = today()): InvoiceState {
  if (invoice.cancelledOn) return 'cancelled'
  if (Number(paid) + 0.005 >= Number(invoice.receivableAmount)) return 'paid'
  if (invoice.dueOn && invoice.dueOn < on) return 'overdue'
  return 'pending'
}

function withState(invoice: Invoice, paid: string, on?: string): InvoiceView {
  return {
    ...invoice,
    paidAmount: Number(paid).toFixed(2),
    remainingAmount: Math.max(0, cents(Number(invoice.receivableAmount) - Number(paid))).toFixed(2),
    state: stateOf(invoice, paid, on),
  }
}

export interface ListInvoicesFilters {
  activityId?: string
  actorId?: string
  state?: InvoiceState
  /** The day states are read against; today unless a test says otherwise. */
  on?: string
}

/** Every invoice of the selection with its state, newest issue first. */
export async function listInvoices(userId: string, f: ListInvoicesFilters = {}): Promise<InvoiceView[]> {
  const rows = await listInvoicesDs(db(), userId, { activityId: f.activityId, actorId: f.actorId })
  const views = rows.map((row: InvoiceWithPayments) => withState(row, row.paidAmount, f.on))
  return f.state ? views.filter((invoice) => invoice.state === f.state) : views
}

/**
 * What is still owed, the work to do: overdue first, the longest overdue on
 * top, then pending by due date, the ones with no due date last. Lives at the
 * head of the activity screen, out of any period, the way open advances do on
 * the ledger: the invoice from four months ago is exactly the forgotten one.
 */
export async function outstandingInvoices(
  userId: string,
  activityId?: string,
  on?: string,
): Promise<InvoiceView[]> {
  const open = (await listInvoices(userId, { activityId, on })).filter(
    (invoice) => invoice.state === 'pending' || invoice.state === 'overdue',
  )
  const rank = (invoice: InvoiceView) => (invoice.state === 'overdue' ? 0 : 1)
  return open.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
      a.issuedOn.localeCompare(b.issuedOn),
  )
}
