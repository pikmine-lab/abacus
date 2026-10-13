import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import { getShareForUpdate, sharesOfMovement, sharesOfMovements } from '../db/datasources/advances.ts'
import { dropEmptyStatements, getCard, statementFor } from '../db/datasources/cards.ts'
import { getActivity, soleActivityOfAccount } from '../db/datasources/catalog.ts'
import { getCommitment } from '../db/datasources/commitments.ts'
import {
  alignInstallmentOnMovement,
  installmentByMovement,
  resyncFinancing,
} from '../db/datasources/installments.ts'
import { getInvoice, paidSoFar } from '../db/datasources/invoices.ts'
import {
  deleteMovementRow,
  getMovement,
  insertMovement,
  listMovements as listMovementsDs,
  type MovementFilters,
  type MovementSelection,
  type MovementSortField,
  selectionTotals as selectionTotalsDs,
  updateMovementRow,
} from '../db/datasources/movements.ts'
import type { ShareInput } from '../domain/advance.ts'
import { cycleOf, isValidOn } from '../domain/card.ts'
import { DomainError } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { SortChoice, SortFields } from '../domain/sort.ts'
import type { Account, Activity, Actor, Invoice, Movement, ShareState } from '../domain/types.ts'
import { fetchHistory, type HistoryFetcher } from '../prices/sources.ts'
import { refundShareFor, setMovementSharesIn } from './advances.ts'
import { eurRateOn, toEur } from './fx.ts'

export interface DeclareMovementInput {
  happenedOn: string
  /** In `currency`: euros unless another code says what was actually paid. */
  amount: number
  /**
   * ISO 4217 code of the amount as it was paid. Foreign: the movement stores
   * its EUR counter-value (the account holds euros), the original alongside.
   */
  currency?: string
  /**
   * With a foreign currency only: the euros the bank actually moved, when the
   * statement says so. Omitted, the counter-value is computed at the
   * transaction day's rate.
   */
  eurAmount?: number
  sourceAccountId?: string
  sourceActorId?: string
  targetAccountId?: string
  targetActorId?: string
  categoryId?: string
  /** Omitted: inherited from the external actor. Explicit null: none. */
  activityId?: string | null
  note?: string
  commitmentId?: string
  balanceCheckId?: string
  /**
   * Marks the expense as an advance: who owes what of it back, one share per
   * person, adding up to at most the amount.
   */
  refundShares?: ShareInput[]
  /**
   * Links this income to the advanced expense it refunds: the share of the
   * person it comes from, created for what it brings when they owed nothing
   * on it yet.
   */
  refundsMovementId?: string
  /** Links this income to one share: of an expense, or of a financing's total. */
  refundsShareId?: string
  /**
   * The commitment this income was received for: an outgoing subscription or
   * a financing, whose occurrences draw from it (see checkReserve).
   */
  reservesCommitmentId?: string
  /**
   * Incomes already declared that paid this expense back before it was: each
   * becomes the refund of its sender's share, created when they owe nothing
   * on it yet, as a correction of the income would do.
   */
  refundedBy?: string[]
  /**
   * The advance came back the same day: the refund of every share is written
   * in the same transaction, so the account balance never lies in between.
   */
  refundedNow?: boolean
  /**
   * The month this movement is about, when it is not the month it settles in:
   * "YYYY-MM" (a full date is accepted and truncated to its month). Omitted,
   * the movement counts in the month of its date, and keeps following it.
   */
  accrualMonth?: string | null
  /**
   * Out of every analysis: totals, breakdowns, monthly curve. The movement
   * still counts in every balance and in the balance check, and still shows in
   * the movement list. For what did reach the account but says nothing about
   * the flows: an insurance payout, a gift, a regularisation, money from an
   * account that is not tracked.
   */
  ghost?: boolean
  /**
   * The invoice this income pays, in full or in part. Only an income of the
   * invoice's client, in the invoice's activity and currency, can pay it, and
   * the incomes linked to one invoice never add up to more than it asks for.
   */
  invoiceId?: string
  /**
   * The VAT inside `amount`, on a movement of a VAT-registered business
   * activity: what it reclaims on an expense, what it collected on an income
   * that pays no invoice. Part of the amount, never on top of it.
   */
  vatAmount?: number
  /**
   * The card that paid an expense, or that a merchant's refund is credited
   * back to. Omitted, the account was debited directly (a direct debit, a
   * transfer order). With a deferred-debit card, `happenedOn` is the purchase
   * day: the movement is dated on the day the card's schedule debits it, and
   * the purchase day is kept alongside.
   */
  cardId?: string
}

/**
 * A movement once its card has placed it: its statement's debit, the purchase
 * day it came from, and whether that statement still waits for its debit day.
 */
type Dated = DeclareMovementInput & {
  purchasedOn?: string
  cardStatementId?: string
  awaitingDebit?: boolean
}

/**
 * A declared month as the column holds it: that month's first day. "YYYY-MM"
 * is the form both interfaces speak, and a full date is accepted because
 * "attach it to the month of the 5th" states the same thing.
 */
export function monthStart(value: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/.exec(value)
  if (!match) throw new DomainError('bad_month', `"${value}" is not a month: write it as YYYY-MM`)
  return `${match[1]}-${match[2]}-01`
}

function monthOrNothing(value: string | null | undefined): string | undefined {
  return value ? monthStart(value) : undefined
}

async function requireAccount(tx: Executor, userId: string, id: string, role: string): Promise<Account> {
  const account = await getAccount(tx, userId, id)
  if (!account) throw new DomainError('account_not_found', `No ${role} account ${id} for this user`)
  return account
}

async function requireActor(tx: Executor, userId: string, id: string, role: string): Promise<Actor> {
  const actor = await getActor(tx, userId, id)
  if (!actor) throw new DomainError('actor_not_found', `No ${role} actor ${id} for this user`)
  return actor
}

/**
 * What actually hit the account, resolved once. Accounts hold euros, so a
 * foreign amount is converted at the transaction day's rate and frozen (a past
 * expense does not move with today's rate); the bank's own figure wins when
 * the statement gives it. The declared amount stays alongside as the original.
 */
async function inAccountCurrency(
  tx: Executor,
  input: Dated,
  history: HistoryFetcher,
): Promise<Dated & { originalAmount?: number; originalCurrency?: string }> {
  const code = (input.currency ?? 'EUR').toUpperCase()
  if (code === 'EUR') {
    if (input.eurAmount !== undefined)
      throw new DomainError(
        'needless_eur_amount',
        'eurAmount only goes with a foreign currency: the amount is already in euros',
      )
    return { ...input, currency: 'EUR', originalAmount: undefined, originalCurrency: undefined }
  }
  if (input.sourceAccountId && input.targetAccountId)
    throw new DomainError(
      'transfer_stays_eur',
      'A transfer between two of your accounts moves euros: declare it in euros',
    )
  if (input.eurAmount !== undefined && !(input.eurAmount > 0))
    throw new DomainError('bad_amount', 'An amount is always positive')
  // The bank converts on the day of the purchase, not on the day a deferred
  // card debits it.
  const rateOn = input.purchasedOn ?? input.happenedOn
  const eur = input.eurAmount ?? toEur(input.amount, await eurRateOn(tx, code, rateOn, history))
  if (!(eur > 0)) throw new DomainError('bad_amount', `${input.amount} ${code} converts to less than a cent`)
  return {
    ...input,
    amount: eur,
    currency: 'EUR',
    eurAmount: undefined,
    originalAmount: input.amount,
    originalCurrency: code,
  }
}

/**
 * Transaction-aware variant, so other services (commitment confirmation,
 * balance adjustments) can declare a movement inside their own transaction.
 */
export async function declareMovementIn(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const declared = { ...input, accrualMonth: monthOrNothing(input.accrualMonth) }
  const resolved = await inAccountCurrency(tx, await datedByCard(tx, userId, declared), history)
  const { activityId, refundsShareId } = await checkMovement(tx, userId, resolved)
  const {
    refundedNow,
    eurAmount: _,
    awaitingDebit,
    refundShares,
    refundsMovementId: __,
    refundedBy,
    ...row
  } = resolved
  const movement = await insertMovement(tx, { ...row, userId, activityId, refundsShareId })
  await setMovementSharesIn(tx, userId, movement, refundShares)
  for (const income of refundedBy ?? [])
    await correctMovementIn(tx, userId, income, { refundsMovementId: movement.id }, history)
  if (refundedNow) {
    if (!refundShares?.length)
      throw new DomainError(
        'not_an_advance',
        'Only an advance can be refunded on the spot: state who owes what',
      )
    for (const share of await sharesOfMovement(tx, movement.id)) await writeRefundIn(tx, userId, share.id, {})
  }
  return awaitingDebit === undefined ? movement : { ...movement, awaitingDebit }
}

/**
 * The income that brings a share back: it lands on the account that paid,
 * comes from the person who owed it, and defaults to what they still owe. One
 * place decides that, because the web panel, the MCP and an advance refunded
 * on the spot must all write the same movement.
 */
async function writeRefundIn(
  tx: Executor,
  userId: string,
  shareId: string,
  { amount, on }: { amount?: number; on?: string },
): Promise<Movement> {
  const share = await getShareForUpdate(tx, userId, shareId)
  if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
  const owed = Number(share.amount) - Number(share.refunded)
  const received = amount ?? Math.round(owed * 100) / 100
  if (!(received > 0))
    throw new DomainError('advance_settled', 'This share has already been refunded in full')
  const advance = share.movementId ? await getMovement(tx, userId, share.movementId) : undefined
  const financing = share.commitmentId ? await getCommitment(tx, userId, share.commitmentId) : undefined
  return await declareMovementIn(tx, userId, {
    // Paid with a deferred card, the advance is dated on its debit: the
    // person who owed it paid back on the day of the purchase, straight to the
    // account, never to the card.
    happenedOn: on ?? advance?.purchasedOn ?? advance?.happenedOn ?? today(),
    amount: received,
    sourceActorId: share.debtorActorId,
    targetAccountId: advance?.sourceAccountId ?? financing!.accountId,
    refundsShareId: share.id,
  })
}

/**
 * Places a movement paid with a card. The card must belong to the account the
 * movement touches: the one an expense left, the one a merchant's refund came
 * back to. It never pays a transfer between two of the person's accounts, and
 * never receives the refund of an advance: whoever owed it pays the account
 * back, not the card. It works through its expiry month, so a purchase dated
 * later is refused, which is what makes a renewed card get its new expiry.
 *
 * On a deferred-debit card the day given is the purchase day, and the
 * movement joins the statement of its cycle, created with the debit the card's
 * schedule expects if it is the first purchase of that cycle. It is dated on
 * that statement: the day the bank debited it once stated, the expected one
 * until then, and it counts in no balance before that day is stated. The
 * purchase day is kept alongside, and the counted month follows it. `stored`
 * keeps the statement a correction did not move the purchase off.
 */
async function datedByCard(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
  stored?: { happenedOn: string; purchasedOn: string | null; cardStatementId: string | null },
): Promise<Dated> {
  if (!input.cardId) return input
  const card = await getCard(tx, userId, input.cardId)
  if (!card) throw new DomainError('card_not_found', `No card ${input.cardId} for this user`)
  if (input.sourceAccountId && input.targetAccountId)
    throw new DomainError(
      'transfer_has_no_card',
      'A card pays or is refunded: it never moves money between two of your accounts',
    )
  if (input.refundsMovementId || input.refundsShareId)
    throw new DomainError(
      'refund_has_no_card',
      'An advance is paid back to the account, never to the card that paid it',
    )
  if (input.reservesCommitmentId)
    throw new DomainError(
      'reserve_has_no_card',
      'Money received for a commitment lands on an account, never on a card',
    )
  const account = input.sourceAccountId ?? input.targetAccountId
  if (card.accountId !== account)
    throw new DomainError(
      'card_other_account',
      `Card "${card.name}" debits another account than this movement's`,
    )
  if (!isValidOn(card, input.happenedOn))
    throw new DomainError(
      'card_expired',
      `Card "${card.name}" expired at the end of ${card.expiryMonth.slice(0, 7)}: update its expiry if it was renewed`,
    )
  if (stored)
    return {
      ...input,
      happenedOn: stored.happenedOn,
      purchasedOn: stored.purchasedOn ?? undefined,
      cardStatementId: stored.cardStatementId ?? undefined,
    }
  if (card.debitMode === 'immediate') return input
  const statement = await statementFor(tx, card.id, cycleOf(card, input.happenedOn))
  return {
    ...input,
    happenedOn: statement.debitedOn ?? statement.dueOn,
    purchasedOn: input.happenedOn,
    cardStatementId: statement.id,
    awaitingDebit: statement.debitedOn === null,
  }
}

/**
 * The domain rules a movement must satisfy, whether it is being declared or
 * corrected: exactly one endpoint per side, at least one owned account, no
 * category on a transfer, no writing onto a closed account or under a closed
 * activity, a refund paying back a share of the person it comes from (see
 * advances.ts), an invoice paid by its own client and never beyond what it
 * asks. Returns the activity and the refunded share to store.
 *
 * The activity is settled at write time and never again. Explicit wins, and an
 * explicit null means "none". Absent, it is inherited from the invoice the
 * income pays first (that is the sphere the money was earned in, whatever the
 * client is filed under today), then from the external actor (a client carries
 * its activity), then from the account the money touched: the one an expense
 * left, the one an income reached. That last step only decides when the
 * account carries a single activity: an account two activities live on
 * designates neither, so the movement is left without one and is corrected by
 * hand, rather than credited to whichever of them happened to be first. A
 * transfer inherits nothing from its accounts, because the transfer between an
 * activity's account and a personal one is precisely the owner paying
 * themselves, and it belongs to neither side. History is never reclassified
 * when an actor changes activity or an account changes hands: that is an
 * explicit correction, movement by movement.
 */
async function checkMovement(
  tx: Executor,
  userId: string,
  input: Dated,
  /** On a correction: the movement being corrected, left out of the sums it is measured against. */
  except?: string,
  /** On a correction: the reserve the movement fed until now. */
  storedReserve?: string | null,
): Promise<{ activityId: string | null; refundsShareId: string | null }> {
  if ((input.sourceAccountId ? 1 : 0) + (input.sourceActorId ? 1 : 0) !== 1)
    throw new DomainError('bad_source', 'A movement needs exactly one source: an account or an actor')
  if ((input.targetAccountId ? 1 : 0) + (input.targetActorId ? 1 : 0) !== 1)
    throw new DomainError('bad_target', 'A movement needs exactly one target: an account or an actor')
  if (input.sourceActorId && input.targetActorId)
    throw new DomainError('no_owned_account', 'A movement must touch at least one of your accounts')

  const accounts = await Promise.all([
    input.sourceAccountId ? requireAccount(tx, userId, input.sourceAccountId, 'source') : null,
    input.targetAccountId ? requireAccount(tx, userId, input.targetAccountId, 'target') : null,
  ])
  for (const account of accounts) {
    if (account?.closedOn && input.happenedOn > account.closedOn)
      throw new DomainError('account_closed', `Account "${account.name}" is closed since ${account.closedOn}`)
  }

  const isTransfer = Boolean(input.sourceAccountId && input.targetAccountId)
  if (isTransfer && input.categoryId)
    throw new DomainError('transfer_has_no_category', 'An internal transfer carries no category')
  if (isTransfer && input.accrualMonth)
    throw new DomainError(
      'transfer_has_no_accrual',
      'An internal transfer enters no period total, so there is no month for it to be about',
    )
  if (isTransfer && input.ghost)
    throw new DomainError(
      'transfer_is_never_ghost',
      'An internal transfer already enters no period total: it cannot be left out of the analysis',
    )

  const externalActor = input.targetActorId
    ? await requireActor(tx, userId, input.targetActorId, 'target')
    : input.sourceActorId
      ? await requireActor(tx, userId, input.sourceActorId, 'source')
      : null

  await checkReserve(tx, userId, input, storedReserve ?? null)
  const refundsShareId = await refundShareFor(tx, userId, input, input, except)

  const invoice = input.invoiceId ? await checkInvoiceLink(tx, userId, input, except) : null

  const [sourceAccount, targetAccount] = accounts
  const touched = isTransfer ? null : (sourceAccount ?? targetAccount)
  const fromTouched = touched ? await soleActivityOfAccount(tx, touched.id) : null
  const activityId =
    input.activityId !== undefined
      ? input.activityId
      : (invoice?.activityId ?? externalActor?.activityId ?? fromTouched ?? null)
  let activity: Activity | null = null
  if (activityId) {
    activity = (await getActivity(tx, userId, activityId)) ?? null
    if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
    // A deferred card's purchase belongs to the activity it was made under,
    // whatever day the card debits it.
    if (activity.closedOn && (input.purchasedOn ?? input.happenedOn) > activity.closedOn)
      throw new DomainError(
        'activity_closed',
        `Activity "${activity.name}" is closed since ${activity.closedOn}: a later movement belongs to the activity that followed it`,
      )
  }
  checkVat(input, activity)
  return { activityId, refundsShareId }
}

/**
 * Money received for a commitment feeds its reserve: an income, from
 * someone, into an account, for an outgoing subscription or a financing, the
 * only commitments whose occurrences are expenses to draw on. It is no refund
 * of a share and pays no invoice, each of which would count the money a second
 * time. A commitment already over has nothing left to draw: a new link to it
 * is refused, while an income linked before it ended keeps its link through
 * any correction, since that is what makes its remainder an income.
 */
async function checkReserve(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
  stored: string | null,
): Promise<void> {
  if (!input.reservesCommitmentId) return
  if (!(input.sourceActorId && input.targetAccountId))
    throw new DomainError(
      'reserve_is_income',
      'Only an income is received for a commitment: money coming from someone into one of your accounts',
    )
  if (input.refundsShareId || input.refundsMovementId)
    throw new DomainError(
      'reserve_or_refund',
      'An income either pays back a share or feeds a commitment’s reserve, never both',
    )
  if (input.invoiceId)
    throw new DomainError(
      'reserve_has_no_invoice',
      'An income paying an invoice is earned: it does not feed a commitment’s reserve',
    )
  const commitment = await getCommitment(tx, userId, input.reservesCommitmentId)
  if (!commitment)
    throw new DomainError('commitment_not_found', `No commitment ${input.reservesCommitmentId} for this user`)
  const drawable =
    commitment.kind === 'financing' ||
    (commitment.kind === 'subscription' && commitment.direction === 'outgoing')
  if (!drawable)
    throw new DomainError(
      'reserve_needs_expense',
      'Only an outgoing subscription or a financing has occurrences to draw on a reserve',
    )
  if (input.reservesCommitmentId !== stored && (commitment.cancelledOn || commitment.settledOn))
    throw new DomainError(
      'commitment_over',
      `"${commitment.label}" is over since ${commitment.cancelledOn ?? commitment.settledOn}: nothing will draw on this money`,
    )
}

/**
 * The VAT inside a movement is a figure only where a regime reclaims it: on an
 * expense or an income of a VAT-registered business activity. Anywhere else
 * nothing would ever read it (the measures leave it out when the activity
 * reclaims none) while it would still look like a declared fact, so it is
 * refused rather than stored and forgotten.
 */
function checkVat(input: DeclareMovementInput, activity: Activity | null): void {
  if (input.vatAmount === undefined) return
  if (input.sourceAccountId && input.targetAccountId)
    throw new DomainError('transfer_has_no_vat', 'An internal transfer carries no VAT')
  if (input.vatAmount < 0 || input.vatAmount > input.amount)
    throw new DomainError(
      'vat_outside_amount',
      `The VAT (${input.vatAmount}) is inside the amount (${input.amount}), so it cannot exceed it`,
    )
  if (activity?.kind !== 'business' || !activity.vatRegistered)
    throw new DomainError(
      'vat_needs_registered_activity',
      'Only a movement of a VAT-registered business activity states the VAT inside it',
    )
}

/**
 * An income pays an invoice only when everything about it agrees with the
 * invoice: it comes from the invoice's client, into an account, in the
 * invoice's currency and activity, on an invoice not cancelled, and what the
 * linked incomes add up to never exceeds what the invoice asks for. Partial
 * payments are the ordinary case; an overpayment is a typo or another
 * invoice, never something to record here.
 */
async function checkInvoiceLink(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput & { originalAmount?: number; originalCurrency?: string },
  except?: string,
): Promise<Invoice> {
  const invoice = await getInvoice(tx, userId, input.invoiceId!)
  if (!invoice) throw new DomainError('invoice_not_found', `No invoice ${input.invoiceId} for this user`)
  if (!(input.sourceActorId && input.targetAccountId))
    throw new DomainError('invoice_needs_income', 'Only an income can pay an invoice')
  if (input.sourceActorId !== invoice.actorId)
    throw new DomainError('invoice_other_client', 'An invoice is paid by the client it was issued to')
  if (input.activityId !== undefined && input.activityId !== invoice.activityId)
    throw new DomainError(
      'invoice_other_activity',
      'An income paying an invoice belongs to the invoice’s activity',
    )
  if (invoice.cancelledOn)
    throw new DomainError('invoice_cancelled', `This invoice was cancelled on ${invoice.cancelledOn}`)
  const paidIn = input.originalCurrency ?? 'EUR'
  if (paidIn !== invoice.currency)
    throw new DomainError(
      'invoice_currency_mismatch',
      `This invoice is in ${invoice.currency}: an income paying it is declared in ${invoice.currency}`,
    )
  const paid = Number(await paidSoFar(tx, invoice.id, except))
  const received = input.originalAmount ?? input.amount
  const remaining = Number(invoice.receivableAmount) - paid
  if (received > remaining + 0.005)
    throw new DomainError(
      'invoice_overpaid',
      `This income (${received}) exceeds what is left to receive on the invoice (${remaining.toFixed(2)})`,
    )
  return invoice
}

export async function declareMovement(
  userId: string,
  input: DeclareMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => declareMovementIn(tx, userId, input, history))
}

export type { MovementFilters, MovementSelection }

/** Fields a correction may touch; anything absent keeps its current value. */
export interface CorrectMovementInput {
  happenedOn?: string
  /** Alone: the euros that hit the account. With `currency`: what was paid abroad. */
  amount?: number
  /**
   * Redeclares the money side, as on declaration: a foreign code converts the
   * amount at the day's rate (unless eurAmount gives the bank's figure) and
   * keeps the original alongside; 'EUR' drops a wrongly declared original.
   * Absent, the stored original is kept as it is.
   */
  currency?: string
  eurAmount?: number
  sourceAccountId?: string | null
  sourceActorId?: string | null
  targetAccountId?: string | null
  targetActorId?: string | null
  categoryId?: string | null
  activityId?: string | null
  note?: string | null
  /**
   * Who owes what of the expense, restated whole: a share kept by its person
   * keeps its refunds and its plan, null or an empty list drops them all.
   * Dropping a share that has refunds is refused here: removeShare does it,
   * by name. Absent, the stored shares are kept, and checked against the
   * corrected movement.
   */
  refundShares?: ShareInput[] | null
  /**
   * The expense this income pays back (the share of the person it comes
   * from), or the share itself: an id links it, null unlinks it, and the
   * income is then a plain income again. Absent, the stored link is kept.
   */
  refundsMovementId?: string | null
  refundsShareId?: string | null
  /** Incomes already declared to link to this expense, as on declaration. */
  refundedBy?: string[]
  /**
   * The commitment this income was received for: an id links it, null
   * unlinks it, and the income is then a plain income again. Absent, the
   * stored link is kept.
   */
  reservesCommitmentId?: string | null
  /**
   * The month the movement is about: "YYYY-MM" attaches it, null detaches it
   * (it then follows its date again). Absent, the stored one is kept, which is
   * the whole point of storing it: correcting a date must not move a month
   * that was stated on purpose.
   */
  accrualMonth?: string | null
  /** Out of every analysis, or back in. Absent, the stored value is kept. */
  ghost?: boolean
  /** The invoice this income pays: an id links it, null unlinks it. Absent, the stored link is kept. */
  invoiceId?: string | null
  /** The VAT inside the amount: a figure states it, null clears it. Absent, the stored one is kept. */
  vatAmount?: number | null
  /**
   * The card that paid: an id sets it, null says the account was debited
   * directly. Absent, the stored one is kept. On a movement paid with a
   * deferred card, `happenedOn` is the purchase day, as on declaration.
   */
  cardId?: string | null
}

const CORRECTABLE = [
  'happenedOn',
  'purchasedOn',
  'cardId',
  'cardStatementId',
  'amount',
  'accrualMonth',
  'ghost',
  'invoiceId',
  'vatAmount',
  'reservesCommitmentId',
  'sourceAccountId',
  'sourceActorId',
  'targetAccountId',
  'targetActorId',
  'categoryId',
  'activityId',
  'note',
] as const

/**
 * Corrects a declared movement. A declarative ledger is only as good as the
 * user's ability to fix a typo, so this exists: but it is a correction, not a
 * rewrite: the origin links (commitment, balance check) are never touched
 * here, and the merged result must satisfy the same domain rules as a fresh
 * declaration. The advance links are the exception, because they are what
 * the person sees and repairs on the movement itself: its shares, and the
 * share an income pays back.
 *
 * The stored activity is not re-inherited from a changed actor or account:
 * history stays stable unless the activity is set explicitly (same rule as
 * declaration).
 */
export async function correctMovement(
  userId: string,
  id: string,
  input: CorrectMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => await correctMovementIn(tx, userId, id, input, history))
}

/**
 * Transaction-aware variant, so a schedule revision can correct the movements
 * of the installments it touches inside its own transaction.
 */
export async function correctMovementIn(
  tx: Executor,
  userId: string,
  id: string,
  input: CorrectMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const current = await getMovement(tx, userId, id)
  if (!current) throw new DomainError('movement_not_found', `No movement ${id} for this user`)

  // Touching the currency redeclares the money side, so the amount defaults to
  // the stored original (the declared figure), not to its counter-value.
  const moneyTouched = input.currency !== undefined || input.eurAmount !== undefined
  const merged: DeclareMovementInput = {
    // The day a person knows: the purchase day of a deferred card purchase,
    // which the card turns into its debit day again below.
    happenedOn: input.happenedOn ?? current.purchasedOn ?? current.happenedOn,
    amount:
      input.amount ??
      (moneyTouched && current.originalAmount !== null
        ? Number(current.originalAmount)
        : Number(current.amount)),
    currency: moneyTouched ? (input.currency ?? current.originalCurrency ?? 'EUR') : 'EUR',
    eurAmount: input.eurAmount,
    sourceAccountId: pick(input, current, 'sourceAccountId'),
    sourceActorId: pick(input, current, 'sourceActorId'),
    targetAccountId: pick(input, current, 'targetAccountId'),
    targetActorId: pick(input, current, 'targetActorId'),
    categoryId: pick(input, current, 'categoryId'),
    note: pick(input, current, 'note'),
    // Explicit null keeps "no activity" from being re-inherited.
    activityId: input.activityId !== undefined ? input.activityId : current.activityId,
    // An income linked anew, or unlinked; absent, it keeps paying back the
    // share it did, which is checked again against what it now says.
    // An income is one link or the other: linking it to a reserve drops the
    // share it paid back, and the reverse.
    ...(input.refundsShareId !== undefined || input.refundsMovementId !== undefined
      ? {
          refundsShareId: input.refundsShareId ?? undefined,
          refundsMovementId: input.refundsMovementId ?? undefined,
        }
      : input.reservesCommitmentId
        ? {}
        : { refundsShareId: current.refundsShareId ?? undefined }),
    invoiceId:
      input.invoiceId !== undefined ? (input.invoiceId ?? undefined) : (current.invoiceId ?? undefined),
    reservesCommitmentId:
      input.reservesCommitmentId !== undefined
        ? (input.reservesCommitmentId ?? undefined)
        : input.refundsShareId || input.refundsMovementId
          ? undefined
          : (current.reservesCommitmentId ?? undefined),
    vatAmount:
      input.vatAmount !== undefined
        ? (input.vatAmount ?? undefined)
        : current.vatAmount !== null
          ? Number(current.vatAmount)
          : undefined,
  }
  // A movement corrected into a transfer moves euros: an original left over
  // from the expense it was would dress an internal move as a foreign payment.
  const becomesTransfer = Boolean(merged.sourceAccountId && merged.targetAccountId)
  // Same for the month it was about: a transfer enters no period total, so an
  // attachment inherited from the expense it was is dropped here. One asked
  // for explicitly is refused instead, by checkMovement below.
  merged.accrualMonth =
    becomesTransfer && input.accrualMonth === undefined
      ? undefined
      : monthOrNothing(input.accrualMonth !== undefined ? input.accrualMonth : current.accrualMonth)
  // And for being left out of the analysis, which a transfer already is: the
  // flag inherited from the expense it was is dropped, one asked for
  // explicitly is refused by checkMovement. Always a boolean, never absent:
  // the column has no null to fall back to.
  merged.ghost = becomesTransfer && input.ghost === undefined ? false : (input.ghost ?? current.ghost)
  // And for the VAT inside it, which a transfer never carries.
  if (becomesTransfer && input.vatAmount === undefined) merged.vatAmount = undefined
  // And for the card that paid it, which a transfer never has: the movement
  // then falls back on the day it was bought.
  merged.cardId =
    input.cardId !== undefined
      ? (input.cardId ?? undefined)
      : becomesTransfer
        ? undefined
        : (current.cardId ?? undefined)
  // A purchase keeps its debit day unless its day or its card is corrected:
  // the day was debited as the card then said, whatever its schedule says now.
  // Compared rather than tested for presence, because the web panel sends the
  // whole movement back, its unchanged day included.
  const sameDay = merged.happenedOn === (current.purchasedOn ?? current.happenedOn)
  const sameCard = merged.cardId === (current.cardId ?? undefined)
  const dated = await datedByCard(
    tx,
    userId,
    merged,
    sameDay && sameCard && merged.cardId ? current : undefined,
  )
  const resolved = moneyTouched
    ? await inAccountCurrency(tx, dated, history)
    : {
        ...dated,
        originalAmount:
          !becomesTransfer && current.originalAmount !== null ? Number(current.originalAmount) : undefined,
        originalCurrency: !becomesTransfer ? (current.originalCurrency ?? undefined) : undefined,
      }
  const { activityId, refundsShareId } = await checkMovement(
    tx,
    userId,
    resolved,
    id,
    current.reservesCommitmentId,
  )

  const row: Record<string, unknown> = {
    activityId,
    refundsShareId,
    originalAmount: resolved.originalAmount ?? null,
    originalCurrency: resolved.originalCurrency ?? null,
  }
  for (const key of CORRECTABLE) {
    if (key === 'activityId') continue
    row[key] = resolved[key] ?? null
  }
  const updated = await updateMovementRow(tx, userId, id, row)
  if (!updated) throw new DomainError('movement_not_found', `No movement ${id} for this user`)
  await setMovementSharesIn(
    tx,
    userId,
    updated,
    input.refundShares === null ? [] : (input.refundShares ?? undefined),
  )
  for (const income of input.refundedBy ?? [])
    await correctMovementIn(tx, userId, income, { refundsMovementId: id }, history)
  // Moved off a statement (another day, another card, no card): the one it
  // left may be empty now.
  if (current.cardId) await dropEmptyStatements(tx, current.cardId)

  // A settled financing installment says what its movement says: the amount
  // debited and the day it was debited. Correcting one corrects the other, or
  // the plan drifts away from what actually left the account. On a foreign
  // plan the installment is written in the billing currency, which on the
  // movement is the original side, not its EUR counter-value: the plan is only
  // realigned when the movement still speaks that currency, so a correction to
  // another one cannot write its units into the plan.
  const settled = await installmentByMovement(tx, id)
  const paid = updated.originalAmount !== null ? Number(updated.originalAmount) : Number(updated.amount)
  const paidCurrency = updated.originalCurrency ?? 'EUR'
  // Paid with a deferred card, the installment was charged on its purchase day.
  const paidOn = updated.purchasedOn ?? updated.happenedOn
  if (
    settled &&
    paidCurrency === settled.planCurrency &&
    (Number(settled.amount) !== paid || settled.dueOn !== paidOn)
  ) {
    await alignInstallmentOnMovement(tx, settled.id, { amount: paid, on: paidOn })
    await resyncFinancing(tx, settled.commitmentId)
  }
  return updated
}

function pick(
  input: CorrectMovementInput,
  current: Movement,
  key: 'sourceAccountId' | 'sourceActorId' | 'targetAccountId' | 'targetActorId' | 'categoryId' | 'note',
): string | undefined {
  const value = input[key] !== undefined ? input[key] : current[key]
  return value ?? undefined
}

/**
 * Removes a declared movement. Refused while another movement refunds one of
 * its shares: the refund would be left pointing at nothing, and the user has
 * to decide which of the two is wrong. Its shares without refunds go with it.
 *
 * When the movement settled a financing installment, that installment becomes
 * owed again (the foreign key frees it) and the plan's cursor is moved back
 * onto it, so what is due reappears instead of being silently skipped.
 */
export async function deleteMovement(userId: string, id: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => await deleteMovementIn(tx, userId, id))
}

/**
 * Transaction-aware variant, so dropping an installment from a plan can drop
 * the movement that paid it in the same transaction.
 */
export async function deleteMovementIn(tx: Executor, userId: string, id: string): Promise<void> {
  const movement = await getMovement(tx, userId, id)
  if (!movement) throw new DomainError('movement_not_found', `No movement ${id} for this user`)
  const [refund] = await tx<{ id: string }[]>`
    select r.id from movement r join advance_share s on s.id = r.refunds_share_id
    where s.movement_id = ${id} limit 1
  `
  if (refund)
    throw new DomainError('refunded_movement', 'A refund is linked to this movement: delete the refund first')
  await deleteMovementRow(tx, userId, id)
  if (movement.commitmentId) await resyncFinancing(tx, movement.commitmentId)
  if (movement.cardId) await dropEmptyStatements(tx, movement.cardId)
}

/**
 * What the ledger can be ordered on, and what each criterion opens on. A
 * chosen order replaces a decided one for the time of a reading: the default
 * stays the date, newest first, because a ledger is read as a history before
 * it is read as a ranking.
 *
 * The list is truncated on screen and by the tools, so the order is settled in
 * SQL: ordering the rows already fetched would rank the page and call it the
 * list, which is a false answer to "my biggest expense".
 */
export const MOVEMENT_SORTS: SortFields<MovementSortField> = {
  date: 'desc',
  counterparty: 'asc',
  account: 'asc',
  category: 'asc',
  amount: 'desc',
}

export const DEFAULT_MOVEMENT_SORT: SortChoice<MovementSortField> = { field: 'date', direction: 'desc' }

/** The ledger, each advanced expense carrying who owes what of it. */
export async function listMovements(userId: string, filters: MovementFilters = {}): Promise<Movement[]> {
  const sql = db()
  const rows = await listMovementsDs(sql, userId, filters)
  const shares = await sharesOfMovements(
    sql,
    rows.filter((m) => m.refunded !== null && m.refunded !== undefined).map((m) => m.id),
  )
  const byMovement = new Map<string, ShareState[]>()
  for (const s of shares) byMovement.set(s.movementId!, [...(byMovement.get(s.movementId!) ?? []), s])
  return rows.map((m) => {
    const own = byMovement.get(m.id)
    return own ? { ...m, shares: own } : m
  })
}

/** What the current filter selects, in one row: count and per-kind totals. */
export async function selectionTotals(
  userId: string,
  filters: MovementFilters = {},
): Promise<MovementSelection> {
  return await selectionTotalsDs(db(), userId, filters)
}

/**
 * The refund arrived: writes the income that pays a share back, in full or in
 * part. Everything it needs is already in the share, so a caller only says
 * what reality changed, the amount received and the day it landed.
 */
export async function refundShare(
  userId: string,
  shareId: string,
  { amount, on }: { amount?: number; on?: string } = {},
): Promise<Movement> {
  const sql = db()
  return await sql.begin(
    async (tx) => await writeRefundIn(tx, userId, shareId, { amount, on: on ?? today() }),
  )
}
