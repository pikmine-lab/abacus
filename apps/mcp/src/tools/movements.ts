import { ADVANCE_FILTERS, claimState, type ShareInput, shareState } from '@abacus/core/domain/advance'
import { DomainError } from '@abacus/core/domain/errors'
import { resolveSort } from '@abacus/core/domain/sort'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { closeShare, openClaims, removeShare, setShareSchedule } from '@abacus/core/services/advances'
import { listCards } from '@abacus/core/services/cards'
import { listCategories } from '@abacus/core/services/catalog'
import { listCommitments } from '@abacus/core/services/commitments'
import {
  correctMovement,
  DEFAULT_MOVEMENT_SORT,
  declareMovement,
  deleteMovement,
  listMovements,
  MOVEMENT_SORTS,
} from '@abacus/core/services/movements'
import { readingPreference } from '@abacus/core/services/preferences'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireCardByName,
  requireCategoryByName,
  requireCommitment,
  requireInvoice,
} from '../resolve.ts'
import { clearable, fail, GUIDANCE, isoDate, ok, orderedBy, run, sortDirection } from './shared.ts'

/** Who owes what of an expense, as the tools that declare and correct one take it. */
export const expectedRefunds = z
  .array(
    z.object({
      from: z.string().describe('Name of the actor who owes this share'),
      amount: z
        .number()
        .positive()
        .describe(
          'What they owe back, in euros. Never assumed: paying 120 for four and being owed 30 by each of three is the ordinary case',
        ),
    }),
  )
  .min(1)

/** The shares as the core states them, each debtor resolved by name. */
export async function sharesOf(
  userId: string,
  list: { from: string; amount: number }[],
  createIfUnknown?: boolean,
): Promise<ShareInput[]> {
  const shares: ShareInput[] = []
  for (const share of list)
    shares.push({
      debtorActorId: (await requireActorByName(userId, share.from, { createIfUnknown })).actor.id,
      amount: share.amount,
    })
  return shares
}

/**
 * Every open claim, told in full: who owes, what is left, what it was
 * advanced on, where a refund lands, and what the debtor's plan says today.
 * The AI reading this never has to look up who or where.
 */
export async function advancesView(userId: string) {
  const [claims, actors, accounts] = await Promise.all([
    openClaims(userId),
    listActors(userId),
    listAccounts(userId),
  ])
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  return claims.map((c) => ({
    claimId: c.share.id,
    debtor: actorName.get(c.share.debtorActorId) ?? '?',
    owed: Number(c.share.amount),
    refunded: Number(c.share.refunded),
    remaining: c.remaining,
    account: accountName.get(c.accountId) ?? '?',
    ...(c.movement
      ? {
          advancedOn: {
            movementId: c.movement.id,
            date: c.movement.purchasedOn ?? c.movement.happenedOn,
            paidTo: actorName.get(c.movement.targetActorId!) ?? '?',
            paid: Number(c.movement.amount),
            note: c.movement.note ?? undefined,
          },
        }
      : {
          advancedOn: {
            financing: c.commitment!.label,
            commitmentId: c.commitment!.id,
            total: Number(c.commitment!.totalAmount),
          },
        }),
    // Absent unless the debtor said when they would pay.
    ...(c.plan.length > 0
      ? {
          plan: c.plan.map((line) => ({ dueOn: line.dueOn, amount: Number(line.amount) })),
          ...(c.nextDueOn ? { nextDueOn: c.nextDueOn, nextDueAmount: c.nextDueAmount } : {}),
          ...(c.lateAmount > 0 ? { late: c.lateAmount } : {}),
        }
      : {}),
  }))
}

export function registerMovementTools(server: McpServer, userId: string): void {
  server.registerTool(
    'declare_movements',
    {
      description:
        'Records a batch of movements the user declares: expenses, incomes, internal transfers. This is the daily entry tool. Everything is addressed by NAME (accounts, actors, categories), never by id. An unknown actor fails its own line with suggestions: reuse a close existing actor instead of creating a duplicate ("McDo" and "McDonald\'s" are the same actor), and only pass createUnknownActors: true for genuinely new actors. Amounts are always positive; the direction comes from the type. An expense or income paid in a foreign currency is declared as paid (amount + currency): the EUR counter-value is computed at that day\'s real rate and stored, so never convert yourself; when the bank statement already shows the euros moved, pass them as eurAmount. A movement that concerns a month other than the one the money moved in says so with month (a late salary, a rent paid ahead): that only moves it in the monthly analysis, never in a balance. A movement that reached the account and says nothing about the flows (an insurance payout, a gift, a regularisation) is declared with ghost: true, which keeps it in the balances and out of every analysis. Do not use it for subscription debits (confirm_due_movements) nor to settle a balance-check gap (settle_check_gap). A client paying an invoice is settle_invoice; an income declared here pays one only when invoice names it. An expense of a VAT-registered business activity says the VAT inside it with vatAmount: that is what the activity reclaims, and without it the VAT return only counts the VAT collected. A purchase paid by card names it with card (manage_cards lists them); on a deferred-debit card, date is the purchase day: the purchase joins the statement of its card for its cycle, dated on the debit that statement expects, and counts in no balance until the statement is validated with the day the bank really debited it (manage_card_statements). Each line succeeds or fails independently: read the result line by line.',
      inputSchema: z.object({
        movements: z
          .array(
            z.object({
              date: isoDate.describe(
                'YYYY-MM-DD, the day it happened. With a deferred-debit card: the purchase day, never the debit day',
              ),
              amount: z
                .number()
                .positive()
                .describe(
                  'Amount, always positive; the direction comes from the type. In euros, or in the currency below when one is given',
                ),
              currency: z
                .string()
                .length(3)
                .optional()
                .describe(
                  "ISO 4217 code the amount was paid in, when not euros (USD, GBP…). Expense/income only. The EUR counter-value is computed at the transaction day's real rate and frozen: never convert yourself",
                ),
              eurAmount: z
                .number()
                .positive()
                .optional()
                .describe(
                  "With a foreign currency only: the euros the bank actually moved, when the statement shows them. Omitted: computed at the day's rate",
                ),
              type: z
                .enum(['expense', 'income', 'transfer'])
                .describe(
                  'expense: account → actor; income: actor → account; transfer: account → account (neutral, never an expense)',
                ),
              account: z
                .string()
                .describe('Account name: the one paying (expense, transfer) or receiving (income)'),
              toAccount: z.string().optional().describe('transfer only: the receiving account'),
              actor: z
                .string()
                .optional()
                .describe(
                  'expense/income: the external counterparty (merchant, client, organization). Forbidden on a transfer',
                ),
              category: z
                .string()
                .optional()
                .describe('Exact name of an existing category. Never on a transfer'),
              card: z
                .string()
                .optional()
                .describe(
                  "Name of the card that paid this expense, or that a merchant's refund was credited back to (manage_cards). It must debit the account given. Leave it out when the account was debited directly: a direct debit, a transfer order, a cheque. Never on a transfer, never on the refund of an advance, which comes back to the account",
                ),
              activity: z
                .string()
                .nullable()
                .optional()
                .describe(
                  'Sphere (e.g. Freelance). Omitted: inherited from the actor, then from the account when a single activity lives on it, an account shared by two designating neither. null: force "none" (personal)',
                ),
              month: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .optional()
                .describe(
                  'YYYY-MM: the month this expense or income is ABOUT, when the money did not move in it. August salary paid on September 2nd → 2026-08; September rent paid on August 30th → 2026-09; August-bought tickets for a September trip → 2026-09. It moves the movement in the monthly analysis and never in a balance. Leave it out whenever the money moved in the month it concerns, which is almost always: an occurrence confirmed with confirm_due_movements sets it by itself. Never on a transfer',
                ),
              ghost: z
                .boolean()
                .optional()
                .describe(
                  'true: the movement counts in every balance and in no analysis (period totals, breakdowns, monthly curve). For what really reached the account but tells nothing about the flows: an insurance payout, a gift received, a regularisation, money coming from an account that is not tracked. An ordinary expense is never a ghost, however large: ask the user rather than deciding. Never on a transfer, which already counts in no total',
                ),
              note: z.string().optional(),
              expectedRefunds: expectedRefunds
                .optional()
                .describe(
                  "Expense advanced on others' behalf: one share per person who owes part of it back. The shares add up to at most the amount, what is left being the user's own part; a person appears once. Ask for each share when it was not stated, never split it yourself",
                ),
              alreadyRefunded: z
                .boolean()
                .optional()
                .describe(
                  'The money of every share came back the same day: their refund incomes are written too, so the balance is right without a second call. Leave it out when the refunds are still awaited',
                ),
              refundsMovementId: z
                .string()
                .optional()
                .describe(
                  'Income paying an advance back: id of the expense it pays back (list_outstanding_advances, list_movements). It pays the share of the actor it comes from; when that actor owed nothing on that expense yet (they paid before it was declared an advance), their share is created for what this income brings. Never more than their share: the rest of a larger payment is another income',
                ),
              claimId: z
                .string()
                .optional()
                .describe(
                  "Income paying a claim back, by its claimId from list_outstanding_advances: the way to pay back a claim on a financing's total, which no single expense carries. The actor must be the claim's debtor",
                ),
              forCommitment: z
                .string()
                .optional()
                .describe(
                  "Income received for a subscription or a financing (label or id from list_commitments): someone gave money to cover its coming occurrences, 400 for a 79 monthly subscription, or part of an instalment purchase. It is no claim, nobody owes it: it feeds the commitment's reserve, and each confirmed occurrence draws what is left of it after its own refunds, the last one only what remains. It is not counted as income while the commitment runs; what is left when it ends becomes an income of that day. A subscription's occurrence only draws money arrived on its day, a financing's from all of it. Not with refundsMovementId, claimId or invoice. To pay back a claim someone owes (list_outstanding_advances), use claimId instead",
                ),
              invoice: z
                .string()
                .optional()
                .describe(
                  "Income paying an invoice: its id or reference, from list_invoices. The actor must be the invoice's client, the amount at most what is left to receive; the activity is the invoice's. Prefer settle_invoice, which fills all of that in",
                ),
              vatAmount: z
                .number()
                .min(0)
                .optional()
                .describe(
                  'The VAT inside amount, in euros, on an expense of a VAT-registered business activity: what the activity reclaims on that purchase. Part of the amount, never on top of it, so at most the amount itself. Pass it whenever the receipt states a VAT and the expense belongs to such an activity, computing it from the rate if only the rate is printed; leave it out everywhere else, where it is refused',
                ),
            }),
          )
          .min(1),
        createUnknownActors: z
          .boolean()
          .optional()
          .describe(
            'Create unknown actors automatically instead of failing with suggestions. Reserve it for genuinely new actors',
          ),
      }),
    },
    async ({ movements, createUnknownActors }) => {
      const results: unknown[] = []
      for (const [index, m] of movements.entries()) {
        try {
          const account = await requireAccountByName(userId, m.account)
          let sourceAccountId: string | undefined
          let targetAccountId: string | undefined
          let sourceActorId: string | undefined
          let targetActorId: string | undefined
          let createdActor: string | undefined
          if (m.type === 'transfer') {
            if (!m.toAccount)
              throw new DomainError('bad_target', 'A transfer requires toAccount (the receiving account).')
            if (m.actor)
              throw new DomainError('bad_target', 'A transfer goes through no actor: drop the actor field.')
            sourceAccountId = account.id
            targetAccountId = (await requireAccountByName(userId, m.toAccount)).id
          } else {
            if (!m.actor)
              throw new DomainError('bad_target', `A ${m.type} requires actor (the external counterparty).`)
            const { actor, created } = await requireActorByName(userId, m.actor, {
              createIfUnknown: createUnknownActors,
            })
            if (created) createdActor = actor.name
            if (m.type === 'expense') {
              sourceAccountId = account.id
              targetActorId = actor.id
            } else {
              sourceActorId = actor.id
              targetAccountId = account.id
            }
          }
          const categoryId = m.category ? (await requireCategoryByName(userId, m.category)).id : undefined
          const activityId =
            m.activity === undefined
              ? undefined
              : m.activity === null
                ? null
                : (await requireActivityByName(userId, m.activity)).id
          const refundShares = m.expectedRefunds
            ? await sharesOf(userId, m.expectedRefunds, createUnknownActors)
            : undefined
          const movement = await declareMovement(userId, {
            happenedOn: m.date,
            amount: m.amount,
            currency: m.currency,
            eurAmount: m.eurAmount,
            sourceAccountId,
            sourceActorId,
            targetAccountId,
            targetActorId,
            categoryId,
            activityId,
            note: m.note,
            accrualMonth: m.month,
            ghost: m.ghost,
            refundShares,
            refundedNow: m.alreadyRefunded,
            refundsMovementId: m.refundsMovementId,
            refundsShareId: m.claimId,
            reservesCommitmentId: m.forCommitment
              ? (await requireCommitment(userId, m.forCommitment)).id
              : undefined,
            invoiceId: m.invoice ? (await requireInvoice(userId, m.invoice)).id : undefined,
            vatAmount: m.vatAmount,
            cardId: m.card ? (await requireCardByName(userId, m.card)).id : undefined,
          })
          results.push({
            index,
            ok: true,
            movementId: movement.id,
            kind: movement.kind,
            // A deferred card moved it to its debit day: say so, it is what the balance reads.
            ...(movement.purchasedOn ? { purchasedOn: movement.purchasedOn } : {}),
            ...(movement.awaitingDebit ? { expectedDebitOn: movement.happenedOn, awaitingDebit: true } : {}),
            ...(movement.accrualMonth ? { month: movement.accrualMonth.slice(0, 7) } : {}),
            ...(movement.ghost ? { ghost: true } : {}),
            ...(movement.vatAmount !== null ? { vatAmount: Number(movement.vatAmount) } : {}),
            // Echo the conversion so the user can hear what was written.
            ...(movement.originalCurrency
              ? {
                  paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}`,
                  eurAmount: Number(movement.amount),
                }
              : {}),
            ...(createdActor ? { createdActor } : {}),
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
    'list_movements',
    {
      description:
        'Browses the movement history, filterable by period, type, account, actor, category, activity or card (all by name), and searchable by free text (search). Each line carries its account, its counterparty and its category, so what was declared can be read back and checked, plus month when it is attached to a month other than its own, ghost when it is left out of the analyses, and the card that paid it. date is the day the money moved: a purchase on a deferred-debit card carries the debit of its statement there and its purchase day in purchasedOn, and awaitingDebit when that statement is not validated yet, in which case date is the expected debit and the purchase counts in no balance. Use it to see what is already there before an entry, to find the id of a movement to repair with fix_movement, or to answer "how much did I spend at X". For grouped totals, prefer analyze_flows. The list comes back newest first unless sortBy says otherwise, and the answer repeats the order it used: the limit cuts the list after it is ordered, so sortBy: amount returns the biggest movements of the selection and not the most recent ones, which is how "my biggest expense of the month" is answered in one call. It is also where the history of advances is read, the ones already refunded or written off included: an advanced expense carries claims, one per person who owes part of it (claimId, debtor, the share owed, what came back so far, its state, the day of the last refund), and claimState, where the expense stands across them; an income paying one back carries refunds, the id of that expense, or refundsFinancing when it pays back a claim on a financing\'s total, with its claimId. An income received for a subscription or a financing carries forCommitment, and an occurrence that drew on that reserve drawnFromReserve, deducted from it in every net. list_outstanding_advances only lists the claims still open.',
      inputSchema: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'What from/to select on. Absent: the reading the user counts in, the one their screens show (manage_preferences says which). cash: the day the money moved. accrual: the month each movement is about, so a salary paid on September 2nd for August comes back in August. An accrual window covers whole months (a month is the finest attachment there is), so it rounds out to them',
          ),
        kind: z.enum(['expense', 'income', 'transfer']).optional(),
        account: z.string().optional().describe('Account name'),
        actor: z.string().optional().describe('Actor name'),
        category: z
          .string()
          .optional()
          .describe(
            'Category name, or "none" for the expenses and incomes carrying no category: the ones left to categorise, the "(none)" row of analyze_flows. A transfer never carries a category and a refund takes the one of its advance, so "none" leaves both out',
          ),
        activity: z
          .string()
          .optional()
          .describe('Activity name, or "none" for what belongs to no activity, transfers included'),
        card: z.string().optional().describe('Card name: what it paid, or was credited back'),
        search: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Free text, read word by word: every word must be found on the movement, each in any of its counterparty (aliases included), note, category or its group, account, or amount. Case and accents are ignored and a word may be a fragment ("resto" finds "Le Petit Restaurant"). A number also reads as the start of an amount: "86" finds 86.00 to 86.99, "86,4" or "86.4" finds 86.40 to 86.49, in euros or, for a movement in a foreign currency, in that currency too (86 USD is found by "86" though it reads 79 euros). So "resto 86" finds the 86-something euros spent at a place whose name holds "resto". Only the first 8 words count. The way to find a movement the user describes from memory; combine it with the other filters as needed. Leave from/to out to search the whole history',
          ),
        advances: z
          .enum(ADVANCE_FILTERS)
          .optional()
          .describe(
            'Keeps one side of the advance mechanism. open: advanced expenses someone still owes on; settled: every share back in full; written_off: nobody owes any more, one share having been closed short of it; refunds: the incomes that brought an advance back. from/to apply to each row\'s own date: an advance is selected on the day it was paid, a refund on the day the money landed, so "what X paid me back in September" is refunds with actor X over September',
          ),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
        sortBy: z
          .enum(['date', 'counterparty', 'account', 'category', 'amount'])
          .optional()
          .describe('What the list is ordered on. Default date, newest first'),
        direction: sortDirection,
      }),
    },
    async (f) =>
      run(async () => {
        const sort = resolveSort(MOVEMENT_SORTS, DEFAULT_MOVEMENT_SORT, f.sortBy, f.direction)
        // Absent, the window selects the way the user counts: asking for
        // August must return the August their screens show.
        const reading = f.reading ?? (await readingPreference(userId))
        const category = clearable(f.category)
        const activity = clearable(f.activity)
        const movements = await listMovements(userId, {
          from: f.from,
          to: f.to,
          reading,
          kind: f.kind,
          accountId: f.account ? (await requireAccountByName(userId, f.account)).id : undefined,
          actorId: f.actor ? (await requireActorByName(userId, f.actor)).actor.id : undefined,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          cardId: f.card ? (await requireCardByName(userId, f.card)).id : undefined,
          search: f.search,
          advances: f.advances,
          limit: f.limit,
          sort,
        })
        const [accounts, actors, categories, cards, commitments] = await Promise.all([
          listAccounts(userId),
          listActors(userId),
          listCategories(userId),
          listCards(userId),
          listCommitments(userId, false),
        ])
        const commitmentLabel = new Map(commitments.map((c) => [c.id, c.label]))
        const accountName = new Map(accounts.map((a) => [a.id, a.name]))
        const actorName = new Map(actors.map((a) => [a.id, a.name]))
        const categoryName = new Map(categories.map((c) => [c.id, c.name]))
        const cardName = new Map(cards.map((c) => [c.id, c.name]))
        return ok({
          order: orderedBy(sort),
          // What the window selected on, only where there was a window: the
          // reading is no longer necessarily the one the caller passed, and a
          // list of "August" that says nothing cannot be read out loud.
          ...(f.from || f.to ? { reading } : {}),
          movements: movements.map((m) => ({
            id: m.id,
            date: m.happenedOn,
            // Absent unless a deferred card put its statement's debit in date.
            ...(m.purchasedOn ? { purchasedOn: m.purchasedOn } : {}),
            ...(m.awaitingDebit ? { awaitingDebit: true } : {}),
            // Absent when the movement counts in the month of its own date.
            ...(m.accrualMonth ? { month: m.accrualMonth.slice(0, 7) } : {}),
            // Absent unless the movement is out of the analyses.
            ...(m.ghost ? { ghost: true } : {}),
            kind: m.kind,
            amount: Number(m.amount),
            // Declared in a foreign currency: amount is its EUR counter-value.
            ...(m.originalCurrency ? { paid: `${Number(m.originalAmount)} ${m.originalCurrency}` } : {}),
            // The owned account the money moved on; on a transfer, the one it left.
            account: accountName.get((m.sourceAccountId ?? m.targetAccountId)!),
            counterparty:
              m.kind === 'transfer'
                ? accountName.get(m.targetAccountId!)
                : actorName.get((m.sourceActorId ?? m.targetActorId)!),
            category: m.categoryId ? categoryName.get(m.categoryId) : undefined,
            card: m.cardId ? cardName.get(m.cardId) : undefined,
            // Absent unless a VAT was stated inside the amount.
            ...(m.vatAmount !== null ? { vatAmount: Number(m.vatAmount) } : {}),
            // Absent unless the movement is an advance, or the refund of one.
            ...(m.shares
              ? {
                  claimState: claimState(m),
                  claims: m.shares.map((share) => ({
                    claimId: share.id,
                    debtor: actorName.get(share.debtorActorId) ?? '?',
                    owed: Number(share.amount),
                    refunded: Number(share.refunded),
                    state: shareState(share),
                    ...(share.lastRefundedOn ? { lastRefundedOn: share.lastRefundedOn } : {}),
                  })),
                }
              : {}),
            // Absent unless the occurrence drew on its commitment's reserve.
            ...(Number(m.drawn) > 0 ? { drawnFromReserve: Number(m.drawn) } : {}),
            ...(m.reservesCommitmentId ? { forCommitment: commitmentLabel.get(m.reservesCommitmentId) } : {}),
            ...(m.refundsShareId
              ? {
                  claimId: m.refundsShareId,
                  ...(m.refundsMovementId ? { refunds: m.refundsMovementId } : {}),
                  ...(m.refundsCommitmentId
                    ? { refundsFinancing: commitmentLabel.get(m.refundsCommitmentId) }
                    : {}),
                }
              : {}),
            note: m.note ?? undefined,
          })),
        })
      }),
  )

  server.registerTool(
    'list_outstanding_advances',
    {
      description:
        'Open claims: what someone owes back of what the user paid for them, one line per person and per thing advanced, so a bill shared by three people is three claims, each paid back on its own. advancedOn says what was advanced: an expense (paid is what left the account, owed this person\'s share of it) or a financing, claimed on its total and paid back on a rhythm of its own. The ones already refunded or written off are read with list_movements and its advances filter. When a refund arrives, declare it with declare_movements as an income of the amount received, on the listed account, from the listed debtor, with claimId set to this claimId: the claim then closes itself, in one go or refund after refund. A claim with a plan (the debtor said when they would pay, manage_claims) carries it, the next payment expected (nextDueOn, nextDueAmount) and late, what the plan expected by today that has not come back: say it when it is there. An abandoned claim ("they will never pay the rest") is closed with close_advance instead: it leaves this list and the expense stays whole.',
      inputSchema: z.object({}),
    },
    async () => run(async () => ok(await advancesView(userId))),
  )

  server.registerTool(
    'close_advance',
    {
      description:
        "Writes off the remainder of one claim: that person will not refund (any more of) it. The others who owe on the same expense still do. The expense stays fully counted in both gross and net; only the claim tracking stops. Practically irreversible: confirm the user's intent before calling.",
      inputSchema: z.object({
        claimId: z.string().describe('Id of the claim, from list_outstanding_advances'),
      }),
    },
    async ({ claimId }) =>
      run(async () => {
        const share = await closeShare(userId, claimId)
        return ok({ claimId: share.id, closed: true })
      }),
  )

  server.registerTool(
    'manage_claims',
    {
      description:
        'Repairs one claim (a claimId from list_outstanding_advances or list_movements) beyond who owes how much, which declare_movements, fix_movement, manage_subscription and declare_financing state. plan records when the debtor said they would pay: count equal payments a period apart from firstDueOn (the last one carrying the rounding), or lines when the promise is uneven; either way it adds up to the claim exactly, and a new plan replaces the old one. drop_plan forgets it: the claim is then never late, nobody having said when. remove drops the claim itself, for a share stated on the wrong person or never owed: the refunds already linked to it are not deleted, the money did come in, they become plain incomes again and count as income. Tell the user that before calling remove when the claim has refunds.',
      inputSchema: z.object({
        claimId: z.string().describe('Id of the claim'),
        action: z.enum(['plan', 'drop_plan', 'remove']),
        count: z.number().int().positive().optional().describe('plan: how many equal payments'),
        firstDueOn: isoDate.optional().describe('plan with count: the day of the first payment'),
        periodUnit: z.enum(['week', 'month', 'year']).optional().describe('plan with count: default month'),
        periodCount: z.number().int().positive().optional().describe('plan with count: default 1'),
        lines: z
          .array(z.object({ dueOn: isoDate, amount: z.number().positive() }))
          .min(1)
          .optional()
          .describe('plan, instead of count: each payment as promised, adding up to the claim'),
      }),
    },
    async (c) =>
      run(async () => {
        if (c.action === 'remove') {
          const detached = await removeShare(userId, c.claimId)
          return ok({ claimId: c.claimId, removed: true, refundsBecameIncomes: detached })
        }
        if (c.action === 'drop_plan') {
          await setShareSchedule(userId, c.claimId, null)
          return ok({ claimId: c.claimId, plan: [] })
        }
        if (!c.lines && !(c.count && c.firstDueOn))
          return fail('plan requires either lines, or count and firstDueOn.')
        const plan = await setShareSchedule(
          userId,
          c.claimId,
          c.lines
            ? { lines: c.lines }
            : {
                count: c.count!,
                firstDueOn: c.firstDueOn!,
                periodUnit: c.periodUnit,
                periodCount: c.periodCount,
              },
        )
        return ok({
          claimId: c.claimId,
          plan: plan.map((l) => ({ dueOn: l.dueOn, amount: Number(l.amount) })),
        })
      }),
  )

  server.registerTool(
    'fix_movement',
    {
      description:
        'Repairs an already declared movement: correct what was mistyped, or delete what should never have been recorded (a duplicate, an entry that turned out not to have happened). Get the id from list_movements first: this tool never guesses which movement is meant. Correcting rebuilds the movement from what you pass: give the type and every field that applies to it, exactly as with declare_movements, because switching an expense to a transfer has to drop its actor and its category. What it never touches: the links to an origin (a confirmed occurrence, a balance-check adjustment). The advance links are repairable from either side. On an expense, expectedRefunds restates who owes what, whole: a person kept keeps their refunds, one left out is dropped, "none" drops them all; a claim that already has refunds cannot be dropped this way (manage_claims remove does it, turning its refunds back into incomes), nor lowered below them. On an income, refundsMovementId links it to the expense it pays back (the share of the person it comes from, created when they owed nothing on it yet), claimId to one claim, and "none" on either unlinks it: it is then a plain income again, counted as income. Deleting is not how you undo a confirmed occurrence: the commitment has already moved on and would need manage_subscription. Prefer correcting over delete-then-redeclare: the movement keeps its identity and its links. Correcting the amount or the date of a movement that settled a financing installment realigns that installment too, so the plan keeps saying what was really paid, and when. On a movement declared in a foreign currency, amount alone corrects the euros that hit the account (what the bank statement shows) and leaves the paid amount as declared; correcting the date alone keeps the euros too; pass currency to redeclare the paid side and reconvert at the day\'s rate. The month it is about is repairable the same way: month attaches it, "none" detaches it, and leaving it out keeps what is stored, so a date fix never moves a month that was stated on purpose. Being out of the analyses is repairable too: ghost true takes it out, false brings it back, absent keeps it. The invoice an income pays is repairable the same way: invoice links it (id or reference from list_invoices), "none" unlinks it, absent keeps it. So is the VAT inside an expense of a VAT-registered business activity: vatAmount states it, null clears it, absent keeps it. And the card that paid it: card names it, "none" says the account was debited directly, absent keeps it. On a movement paid with a deferred-debit card, date is the purchase day (purchasedOn in list_movements), and its statement follows from the card; a correction that touches neither the date nor the card keeps the statement it had. A wrong debit day is fixed on the statement, for every purchase at once (manage_card_statements), never movement by movement.',
      inputSchema: z.object({
        movement: z.string().describe('Id of the movement, from list_movements'),
        action: z.enum(['correct', 'delete']),
        date: isoDate
          .optional()
          .describe('correct: the real date. On a deferred-debit card purchase: the purchase day'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe(
            'correct: the real amount, always positive. Alone: the euros that hit the account. With currency: what was paid in that currency',
          ),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe(
            'correct: redeclares the money side, as on declaration. A foreign ISO code converts the amount at the day\'s rate (unless eurAmount gives the bank\'s figure); "EUR" drops a wrongly declared foreign original. Absent: the stored original is kept',
          ),
        eurAmount: z
          .number()
          .positive()
          .optional()
          .describe('correct, with a foreign currency only: the euros the bank actually moved'),
        type: z
          .enum(['expense', 'income', 'transfer'])
          .optional()
          .describe(
            'correct: required when the endpoints change. expense: account → actor; income: actor → account; transfer: account → account',
          ),
        account: z
          .string()
          .optional()
          .describe('correct: the owned account : paying (expense, transfer) or receiving (income)'),
        toAccount: z.string().optional().describe('correct, transfer only: the receiving account'),
        actor: z
          .string()
          .optional()
          .describe('correct, expense/income only: the external counterparty. Must already exist'),
        category: z
          .string()
          .optional()
          .describe(
            'correct: exact name of an existing category, or "none" to clear it. Never on a transfer',
          ),
        activity: z.string().optional().describe('correct: existing activity name, or "none" to clear it'),
        note: z.string().optional().describe('correct: free note, or "none" to clear it'),
        month: z
          .string()
          .optional()
          .describe(
            'correct: YYYY-MM, the month this movement is about when the money did not move in it, or "none" to detach it (it then follows its date again). Absent: the stored month is kept, so correcting a date never moves a month that was stated on purpose',
          ),
        ghost: z
          .boolean()
          .optional()
          .describe(
            'correct: true leaves the movement out of every analysis while keeping it in the balances, false brings it back in. Absent: the stored value is kept',
          ),
        expectedRefunds: z
          .union([expectedRefunds, z.literal('none')])
          .optional()
          .describe(
            'correct, expense only: every share owed back, restated whole, or "none" to drop them all. Absent: kept',
          ),
        refundsMovementId: z
          .string()
          .optional()
          .describe(
            'correct, income only: id of the expense this income pays back, or "none" to unlink it. Absent: the stored link is kept',
          ),
        claimId: z
          .string()
          .optional()
          .describe('correct, income only: id of the claim this income pays back, or "none" to unlink it'),
        forCommitment: z
          .string()
          .optional()
          .describe(
            'correct, income only: the subscription or financing this income was received for (label or id), feeding its reserve, or "none" to unlink it: it is then a plain income again, counted as income. Absent: the stored link is kept',
          ),
        invoice: z
          .string()
          .optional()
          .describe(
            'correct, income only: the invoice this income pays (id or reference from list_invoices), or "none" to unlink it. Absent: the stored link is kept',
          ),
        vatAmount: z
          .number()
          .min(0)
          .nullable()
          .optional()
          .describe(
            'correct: the VAT inside the amount, on a movement of a VAT-registered business activity, or null to clear it. Absent: the stored one is kept',
          ),
        card: z
          .string()
          .optional()
          .describe(
            'correct: name of the card that paid (manage_cards), or "none" when the account was debited directly. Absent: the stored one is kept',
          ),
      }),
    },
    async (f) =>
      run(async () => {
        if (f.action === 'delete') {
          await deleteMovement(userId, f.movement)
          return ok({ movementId: f.movement, deleted: true })
        }
        const endpoints: Record<string, string | null> = {}
        if (f.type) {
          if (!f.account) return fail('correct with a type requires account.')
          const account = (await requireAccountByName(userId, f.account)).id
          if (f.type === 'transfer') {
            if (!f.toAccount) return fail('correct to a transfer requires toAccount.')
            endpoints.sourceAccountId = account
            endpoints.targetAccountId = (await requireAccountByName(userId, f.toAccount)).id
            endpoints.sourceActorId = null
            endpoints.targetActorId = null
          } else {
            if (!f.actor) return fail(`correct to an ${f.type} requires actor.`)
            const actor = (await requireActorByName(userId, f.actor)).actor.id
            const expense = f.type === 'expense'
            endpoints.sourceAccountId = expense ? account : null
            endpoints.targetActorId = expense ? actor : null
            endpoints.sourceActorId = expense ? null : actor
            endpoints.targetAccountId = expense ? null : account
          }
        }
        const category = clearable(f.category)
        const activity = clearable(f.activity)
        const advanced = clearable(f.refundsMovementId)
        const claim = clearable(f.claimId)
        const invoice = clearable(f.invoice)
        const card = clearable(f.card)
        const reserve = clearable(f.forCommitment)
        const movement = await correctMovement(userId, f.movement, {
          happenedOn: f.date,
          amount: f.amount,
          currency: f.currency,
          eurAmount: f.eurAmount,
          ...endpoints,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          note: clearable(f.note),
          accrualMonth: clearable(f.month),
          ghost: f.ghost,
          refundShares:
            f.expectedRefunds === undefined
              ? undefined
              : f.expectedRefunds === 'none'
                ? null
                : await sharesOf(userId, f.expectedRefunds),
          // "none" on either side unlinks: an income pays back one share or none.
          refundsMovementId: advanced,
          refundsShareId: claim,
          reservesCommitmentId: reserve ? (await requireCommitment(userId, reserve)).id : reserve,
          invoiceId: invoice ? (await requireInvoice(userId, invoice)).id : invoice,
          vatAmount: f.vatAmount,
          cardId: card ? (await requireCardByName(userId, card)).id : card,
        })
        return ok({
          movementId: movement.id,
          date: movement.happenedOn,
          ...(movement.purchasedOn ? { purchasedOn: movement.purchasedOn } : {}),
          ...(movement.accrualMonth ? { month: movement.accrualMonth.slice(0, 7) } : {}),
          ...(movement.ghost ? { ghost: true } : {}),
          amount: Number(movement.amount),
          kind: movement.kind,
          ...(movement.vatAmount !== null ? { vatAmount: Number(movement.vatAmount) } : {}),
          ...(movement.originalCurrency
            ? { paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}` }
            : {}),
        })
      }),
  )
}
