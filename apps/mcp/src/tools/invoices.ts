import { DomainError } from '@abacus/core/domain/errors'
import { listActors } from '@abacus/core/services/actors'
import { listActivities } from '@abacus/core/services/catalog'
import {
  cancelInvoice,
  correctInvoice,
  declareInvoice,
  type InvoiceView,
  listInvoices,
  remindInvoice,
  settleInvoice,
} from '@abacus/core/services/invoices'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireInvoice,
} from '../resolve.ts'
import { clearable, fail, GUIDANCE, isoDate, ok, run } from './shared.ts'

/** Percent, as printed on an invoice. */
const rate = z.number().min(0).max(100)

const STATE = z.enum(['pending', 'overdue', 'paid', 'cancelled'])

/**
 * An invoice as the AI reads it: every figure it may have to repeat to the
 * user, named after what it means rather than after the column.
 */
function invoiceView(
  invoice: InvoiceView,
  names: { actor: Map<string, string>; activity: Map<string, string> },
) {
  return {
    invoiceId: invoice.id,
    activity: names.activity.get(invoice.activityId) ?? '?',
    client: names.actor.get(invoice.actorId) ?? '?',
    reference: invoice.reference ?? undefined,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn ?? undefined,
    state: invoice.state,
    ...(invoice.currency !== 'EUR' ? { currency: invoice.currency } : {}),
    base: Number(invoice.baseAmount),
    vat: Number(invoice.vatAmount),
    ...(Number(invoice.vatRate) ? { vatRate: Number(invoice.vatRate) } : {}),
    withholding: Number(invoice.withholdingAmount),
    ...(Number(invoice.withholdingRate) ? { withholdingRate: Number(invoice.withholdingRate) } : {}),
    // What the client owes, and what reaches the account once the client has
    // kept its withholding back for the tax office.
    total: Number(invoice.totalAmount),
    receivable: Number(invoice.receivableAmount),
    paid: Number(invoice.paidAmount),
    remaining: Number(invoice.remainingAmount),
    remindedOn: invoice.remindedOn ?? undefined,
    cancelledOn: invoice.cancelledOn ?? undefined,
    note: invoice.note ?? undefined,
  }
}

async function names(userId: string) {
  const [actors, activities] = await Promise.all([listActors(userId), listActivities(userId)])
  return {
    actor: new Map(actors.map((a) => [a.id, a.name])),
    activity: new Map(activities.map((a) => [a.id, a.name])),
  }
}

export function registerInvoiceTools(server: McpServer, userId: string): void {
  server.registerTool(
    'declare_invoices',
    {
      description:
        "Records invoices a business activity issued, in batch. Invoiced is not received: an invoice says what a client owes and since when; the money is a separate fact, written by settle_invoice when it lands, never by declare_movements. Everything is addressed by name: the activity (a business one) and the client (an actor). The figures are those printed on the invoice: baseAmount excluding VAT; the VAT collected on top (vatRate or vatAmount), which the user owes to the tax office and is not revenue; the withholding a business client keeps back and pays to the tax office in the user's name (withholdingRate or withholdingAmount), which is tax already paid. The client owes base + VAT (total); what reaches the account is base + VAT − withholding (receivable). A rate left out comes from the client's defaults, then from the activity's default VAT; an amount left out is its rate applied to the base, rounded to the cent; an amount given is kept as written, so pass the printed figures when you have them. abacus records invoices, it does not issue them: no numbering, no legal document, and the reference is the one the invoicing tool gave. Each line succeeds or fails on its own.",
      inputSchema: z.object({
        invoices: z
          .array(
            z.object({
              activity: z.string().describe('The business activity that issued it, by name'),
              client: z.string().describe('The client, an actor by name'),
              reference: z
                .string()
                .optional()
                .describe('The number printed on the invoice; unique within the activity'),
              issuedOn: isoDate.describe('Issue date'),
              dueOn: isoDate.optional().describe('Payment due date; the invoice reads as overdue past it'),
              baseAmount: z
                .number()
                .positive()
                .describe('Excluding VAT, in the currency below (euros by default)'),
              vatRate: rate
                .optional()
                .describe("Percent. Omitted: the client's default, then the activity's"),
              vatAmount: z.number().min(0).optional().describe('As printed; omitted: computed from vatRate'),
              withholdingRate: rate
                .optional()
                .describe(
                  "Percent of the base the client keeps back for the tax office. Omitted: the client's default, else none",
                ),
              withholdingAmount: z
                .number()
                .min(0)
                .optional()
                .describe('As printed; omitted: computed from withholdingRate'),
              currency: z
                .string()
                .length(3)
                .optional()
                .describe("ISO 4217 code when the invoice is not in the activity's currency"),
              note: z.string().optional(),
            }),
          )
          .min(1),
        createUnknownActors: z
          .boolean()
          .optional()
          .describe(
            'Create unknown clients as actors instead of failing with suggestions. Reserve it for genuinely new clients',
          ),
      }),
    },
    async ({ invoices, createUnknownActors }) => {
      const results: unknown[] = []
      for (const [index, line] of invoices.entries()) {
        try {
          const activity = await requireActivityByName(userId, line.activity)
          const { actor, created } = await requireActorByName(userId, line.client, {
            createIfUnknown: createUnknownActors,
          })
          const invoice = await declareInvoice(userId, {
            activityId: activity.id,
            actorId: actor.id,
            reference: line.reference,
            issuedOn: line.issuedOn,
            dueOn: line.dueOn,
            baseAmount: line.baseAmount,
            vatRate: line.vatRate,
            vatAmount: line.vatAmount,
            withholdingRate: line.withholdingRate,
            withholdingAmount: line.withholdingAmount,
            currency: line.currency,
            note: line.note,
          })
          results.push({
            index,
            ok: true,
            invoiceId: invoice.id,
            reference: invoice.reference ?? undefined,
            state: invoice.state,
            vat: Number(invoice.vatAmount),
            withholding: Number(invoice.withholdingAmount),
            total: Number(invoice.totalAmount),
            receivable: Number(invoice.receivableAmount),
            ...(created ? { createdClient: actor.name } : {}),
          })
        } catch (e) {
          if (e instanceof DomainError)
            results.push({ index, ok: false, error: GUIDANCE[e.code] ?? e.message })
          else throw e
        }
      }
      const failed = results.filter((r) => !(r as { ok: boolean }).ok).length
      return ok({ results, declared: results.length - failed, failed })
    },
  )

  server.registerTool(
    'list_invoices',
    {
      description:
        'The invoices of the user\'s activities with their state, which is read from the facts and never stored: pending (awaiting payment, not yet due), overdue (unpaid past dueOn), paid (the linked incomes reach the receivable), cancelled. Each row says what the client owes (total = base + VAT), what should reach the account (receivable = total − withholding), what has been paid and what is left. The answer opens with the outstanding figures: how many invoices are pending and overdue, and what is left to receive on each group, which is how "who owes me what" and "how much is late" are answered in one call. Filter by activity and state. Use it to get an invoice\'s id before settle_invoice or fix_invoice.',
      inputSchema: z.object({
        activity: z.string().optional().describe('Activity name; absent: every activity'),
        state: STATE.optional().describe('Only invoices in that state'),
      }),
    },
    async (f) =>
      run(async () => {
        const activityId = f.activity ? (await requireActivityByName(userId, f.activity)).id : undefined
        const invoices = await listInvoices(userId, { activityId, state: f.state })
        const lookup = await names(userId)
        const group = (state: 'pending' | 'overdue') => {
          const rows = invoices.filter((i) => i.state === state)
          return {
            count: rows.length,
            remaining: Math.round(rows.reduce((sum, i) => sum + Number(i.remainingAmount), 0) * 100) / 100,
          }
        }
        return ok({
          outstanding: { pending: group('pending'), overdue: group('overdue') },
          invoices: invoices.map((invoice) => invoiceView(invoice, lookup)),
        })
      }),
  )

  server.registerTool(
    'settle_invoice',
    {
      description:
        "The client paid: writes the income that pays the invoice, from the client onto the named account, in the invoice's activity, linked to the invoice. This is how an invoice becomes paid: never declare that income with declare_movements on its own. The amount defaults to what is left to receive; pass it when the payment is partial, the invoice then stays pending or overdue for the rest and a later call pays that. More than the remainder is refused: a bigger payment is another invoice or a typo. A client that withholds tax pays the receivable (base + VAT − withholding), not the total: that difference is not money missing, it is tax paid in the user's name.",
      inputSchema: z.object({
        invoice: z.string().describe('Id or reference of the invoice, from list_invoices'),
        activity: z
          .string()
          .optional()
          .describe('Needed with a reference only when several activities reuse the same numbering'),
        account: z.string().describe('The account the money landed on, by name'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Received, in the invoice currency. Absent: what is left'),
        date: isoDate.optional().describe('The day it landed. Absent: today'),
      }),
    },
    async (a) =>
      run(async () => {
        const target = await requireInvoice(userId, a.invoice, a.activity)
        const account = await requireAccountByName(userId, a.account)
        const { movement, invoice } = await settleInvoice(userId, target.id, {
          amount: a.amount,
          date: a.date,
          accountId: account.id,
        })
        return ok({
          movementId: movement.id,
          date: movement.happenedOn,
          amount: Number(movement.amount),
          ...(movement.originalCurrency
            ? { paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}` }
            : {}),
          account: account.name,
          invoice: {
            invoiceId: invoice.id,
            reference: invoice.reference ?? undefined,
            paid: Number(invoice.paidAmount),
            remaining: Number(invoice.remainingAmount),
            state: invoice.state,
          },
        })
      }),
  )

  server.registerTool(
    'fix_invoice',
    {
      description:
        'Repairs a recorded invoice. correct: what was mistyped (client, reference, dates, amounts, currency, note). An amount you pass is kept as written; one you leave out is recomputed from its rate when the base or that rate changed, kept otherwise; the receivable cannot drop below what has already been paid, and the client cannot change while incomes from it are linked. remind: the client was reminded on that day (today by default), so the list says how long ago. cancel: the client will never pay, the invoice leaves the outstanding list and keeps its dates; refused once money is linked to it, unlink or delete those incomes first with fix_movement. An invoice never changes activity: that is another invoice. Get the id from list_invoices.',
      inputSchema: z.object({
        invoice: z.string().describe('Id or reference of the invoice, from list_invoices'),
        activity: z
          .string()
          .optional()
          .describe('Needed with a reference only when several activities reuse the same numbering'),
        action: z.enum(['correct', 'remind', 'cancel']),
        on: isoDate.optional().describe('remind/cancel: the day it happened. Absent: today'),
        client: z.string().optional().describe('correct: the client, an existing actor by name'),
        reference: z.string().optional().describe('correct: the printed reference, or "none" to clear it'),
        issuedOn: isoDate.optional().describe('correct'),
        dueOn: z.string().optional().describe('correct: YYYY-MM-DD, or "none" to clear it'),
        baseAmount: z.number().positive().optional().describe('correct: excluding VAT'),
        vatRate: rate.optional().describe('correct: percent'),
        vatAmount: z.number().min(0).optional().describe('correct: as printed'),
        withholdingRate: rate.optional().describe('correct: percent of the base'),
        withholdingAmount: z.number().min(0).optional().describe('correct: as printed'),
        currency: z.string().length(3).optional().describe('correct: ISO 4217 code'),
        note: z.string().optional().describe('correct: free note, or "none" to clear it'),
      }),
    },
    async (a) =>
      run(async () => {
        const target = await requireInvoice(userId, a.invoice, a.activity)
        const lookup = await names(userId)
        if (a.action === 'remind')
          return ok(invoiceView(await remindInvoice(userId, target.id, a.on), lookup))
        if (a.action === 'cancel')
          return ok(invoiceView(await cancelInvoice(userId, target.id, a.on), lookup))
        const dueOn = clearable(a.dueOn)
        if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn))
          return fail('dueOn is a date in YYYY-MM-DD format, or "none".')
        const corrected = await correctInvoice(userId, target.id, {
          actorId: a.client ? (await requireActorByName(userId, a.client)).actor.id : undefined,
          reference: clearable(a.reference),
          issuedOn: a.issuedOn,
          dueOn,
          baseAmount: a.baseAmount,
          vatRate: a.vatRate,
          vatAmount: a.vatAmount,
          withholdingRate: a.withholdingRate,
          withholdingAmount: a.withholdingAmount,
          currency: a.currency,
          note: clearable(a.note),
        })
        return ok(invoiceView(corrected, lookup))
      }),
  )
}
