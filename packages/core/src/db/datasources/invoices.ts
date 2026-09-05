import type { Invoice } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewInvoice {
  userId: string
  activityId: string
  actorId: string
  reference?: string | null
  issuedOn: string
  dueOn?: string | null
  currency?: string
  baseAmount: number
  vatRate: number
  vatAmount: number
  withholdingRate: number
  withholdingAmount: number
  note?: string | null
}

/** An invoice with what the linked incomes have brought so far. */
export type InvoiceWithPayments = Invoice & { paidAmount: string }

export async function insertInvoice(tx: Executor, row: NewInvoice): Promise<Invoice> {
  const [invoice] = await tx<Invoice[]>`insert into invoice ${tx(compact(row))} returning *`
  return invoice!
}

export async function getInvoice(tx: Executor, userId: string, id: string): Promise<Invoice | undefined> {
  const [invoice] = await tx<Invoice[]>`select * from invoice where user_id = ${userId} and id = ${id}`
  return invoice
}

export async function updateInvoiceRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Invoice | undefined> {
  const [invoice] = await tx<Invoice[]>`
    update invoice set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return invoice
}

/**
 * What the linked incomes have paid, in the invoice's own currency: the
 * declared figure of a foreign income, its euros otherwise. `except` leaves
 * one movement out, so a correction is measured against the others alone.
 */
export async function paidSoFar(tx: Executor, invoiceId: string, except?: string): Promise<string> {
  const [row] = await tx<{ total: string }[]>`
    select coalesce(sum(coalesce(original_amount, amount)), 0)::numeric(14,2) as total
    from movement
    where invoice_id = ${invoiceId}
    ${except ? tx`and id <> ${except}` : tx``}
  `
  return row!.total
}

export interface InvoiceFilters {
  activityId?: string
  actorId?: string
}

/**
 * Every invoice of the selection with what has been paid on it, newest issue
 * first. The state is derived by the service from these figures: it is never
 * a column, so nothing here filters on it.
 */
export async function listInvoices(
  tx: Executor,
  userId: string,
  f: InvoiceFilters = {},
): Promise<InvoiceWithPayments[]> {
  return await tx<InvoiceWithPayments[]>`
    select i.*, coalesce(p.total, 0)::numeric(14,2) as paid_amount
    from invoice i
    left join lateral (
      select sum(coalesce(m.original_amount, m.amount)) as total
      from movement m where m.invoice_id = i.id
    ) p on true
    where i.user_id = ${userId}
    ${f.activityId ? tx`and i.activity_id = ${f.activityId}` : tx``}
    ${f.actorId ? tx`and i.actor_id = ${f.actorId}` : tx``}
    order by i.issued_on desc, i.created_at desc
  `
}
