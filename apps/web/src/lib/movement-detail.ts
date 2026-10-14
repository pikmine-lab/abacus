import type { ClaimState, Commitment, Movement, MovementKind, PeriodUnit } from '@abacus/core/domain'
import { shareState } from '@abacus/core/domain/advance'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCards } from '@abacus/core/services/cards'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listCommitments } from '@abacus/core/services/commitments'
import { listInvoices } from '@abacus/core/services/invoices'
import { listMovements, readMovement } from '@abacus/core/services/movements'
import type { MovementDraft } from '@/components/movement-form'
import { refundLabels } from '@/lib/advance-data'
import { movementDraft } from '@/lib/movement-form-data'

/**
 * Another movement this one is linked to, by an advance or its refund: the
 * first facts of it, enough to recognise it without leaving the reading.
 */
export interface LinkedMovement {
  id: string
  kind: MovementKind
  counterparty: string
  amount: string
  /** The day the person knows: a purchase on a deferred card reads on its purchase day. */
  on: string
  account: string
  category?: string
  note?: string
}

/**
 * The commitment a movement is tied to: an occurrence of it, money received
 * for its reserve, the refund of a share of a financing's total, or the refund
 * of a share advanced on one of its occurrences. It has no page of
 * its own, so it leads to its row on the screen that lists it.
 */
export interface LinkedCommitment {
  /**
   * `advance`: a refund of a share advanced on one occurrence, whose
   * commitment is the one that occurrence belongs to.
   */
  relation: 'occurrence' | 'reserve' | 'refund' | 'advance'
  label: string
  kind: 'subscription' | 'financing' | 'income' | 'investment_plan'
  amount: string
  currency: string
  periodUnit: PeriodUnit
  periodCount: number
  href: string
}

/**
 * A declared movement as its reading panel shows it: every fact it carries,
 * named, including the ones its row leaves out (its activity, its VAT, what it
 * settles). Absent fields are facts the movement does not carry.
 */
export interface MovementReading {
  id: string
  kind: MovementKind
  /** The actor, or the two accounts of a transfer. */
  counterparty: string
  amount: string
  originalAmount?: string
  originalCurrency?: string
  /** The day the money moved: with a deferred card, the debit of its statement. */
  happenedOn: string
  purchasedOn?: string
  awaitingDebit?: boolean
  accrualMonth?: string
  /** The account the money left (expense, transfer) or reached (income). */
  account: string
  toAccount?: string
  card?: string
  category?: string
  activity?: string
  vatAmount?: string
  note?: string
  ghost: boolean
  /** Who owes what of an advance, where each share stands, and the incomes that paid it back. */
  shares: {
    debtor: string
    amount: string
    refunded: string
    state: ClaimState
    refunds: LinkedMovement[]
  }[]
  /** What a refund pays back, named: an expense, or a claim on a financing. */
  paysBack?: string
  /** The expense a refund pays back, when it is one. */
  paysBackMovement?: LinkedMovement
  /** The commitment whose reserve an income feeds, named. */
  receivedFor?: string
  /** The commitment this movement is tied to, whichever the tie. */
  commitment?: LinkedCommitment
  /** What an occurrence drew from money received ahead. */
  drawn?: string
  /** The invoice an income settles, by its reference or its issue day. */
  invoice?: { reference: string | null; issuedOn: string }
  origin?: 'commitment' | 'balanceCheck'
}

/**
 * One movement, read alone: what its panel shows, and the draft its
 * correction starts from. Null when this user has no such movement.
 */
export async function movementDetail(
  userId: string,
  id: string,
): Promise<{ reading: MovementReading; draft: MovementDraft } | null> {
  const m = await readMovement(userId, id)
  if (!m) return null
  const shareIds = (m.shares ?? []).map((share) => share.id)
  const [accounts, actors, categories, activities, cards, refunds, expense] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    listCards(userId),
    // Oldest first: a share is paid back in that order.
    shareIds.length > 0
      ? listMovements(userId, {
          refundsShareIds: shareIds,
          limit: 500,
          sort: { field: 'date', direction: 'asc' },
        })
      : [],
    m.refundsMovementId ? readMovement(userId, m.refundsMovementId) : null,
  ])
  // A refund of an occurrence's share reaches the commitment through that occurrence.
  const commitmentId =
    m.commitmentId ?? m.reservesCommitmentId ?? m.refundsCommitmentId ?? expense?.commitmentId ?? null
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const [tied, labels, invoice] = await Promise.all([
    // Ended ones included: an old occurrence still belongs to its commitment.
    commitmentId
      ? listCommitments(userId, false).then((all) => all.find((c) => c.id === commitmentId))
      : undefined,
    refundLabels(userId, [m], actorName),
    m.invoiceId
      ? listInvoices(userId, { actorId: m.sourceActorId ?? undefined }).then((all) =>
          all.find((i) => i.id === m.invoiceId),
        )
      : undefined,
  ])

  const counterparty = (x: Movement) =>
    x.kind === 'transfer'
      ? `${accountName.get(x.sourceAccountId!) ?? '?'} → ${accountName.get(x.targetAccountId!) ?? '?'}`
      : (actorName.get((x.kind === 'income' ? x.sourceActorId : x.targetActorId)!) ?? '?')
  const ownAccount = (x: Movement) =>
    accountName.get((x.kind === 'income' ? x.targetAccountId : x.sourceAccountId)!) ?? '?'
  const linked = (x: Movement): LinkedMovement => ({
    id: x.id,
    kind: x.kind,
    counterparty: counterparty(x),
    amount: x.amount,
    on: x.purchasedOn ?? x.happenedOn,
    account: ownAccount(x),
    category: x.categoryId ? categoryName.get(x.categoryId) : undefined,
    note: x.note ?? undefined,
  })

  const isTransfer = m.kind === 'transfer'
  const reading: MovementReading = {
    id: m.id,
    kind: m.kind,
    counterparty: counterparty(m),
    amount: m.amount,
    originalAmount: m.originalAmount ?? undefined,
    originalCurrency: m.originalCurrency ?? undefined,
    happenedOn: m.happenedOn,
    purchasedOn: m.purchasedOn ?? undefined,
    awaitingDebit: m.awaitingDebit || undefined,
    accrualMonth: m.accrualMonth?.slice(0, 7),
    account: ownAccount(m),
    toAccount: isTransfer ? (accountName.get(m.targetAccountId!) ?? '?') : undefined,
    card: m.cardId ? cards.find((c) => c.id === m.cardId)?.name : undefined,
    category: m.categoryId ? categoryName.get(m.categoryId) : undefined,
    activity: m.activityId ? activities.find((a) => a.id === m.activityId)?.name : undefined,
    vatAmount: m.vatAmount ?? undefined,
    note: m.note ?? undefined,
    ghost: m.ghost,
    shares: (m.shares ?? []).map((share) => ({
      debtor: actorName.get(share.debtorActorId) ?? '?',
      amount: share.amount,
      refunded: share.refunded,
      state: shareState(share),
      refunds: refunds.filter((r) => r.refundsShareId === share.id).map(linked),
    })),
    paysBack: m.refundsShareId ? labels.get(m.refundsShareId) : undefined,
    paysBackMovement: expense ? linked(expense) : undefined,
    receivedFor: m.reservesCommitmentId ? labels.get(m.reservesCommitmentId) : undefined,
    commitment: tied
      ? linkedCommitment(
          tied,
          m.commitmentId
            ? 'occurrence'
            : m.reservesCommitmentId
              ? 'reserve'
              : m.refundsCommitmentId
                ? 'refund'
                : 'advance',
        )
      : undefined,
    drawn: m.drawn ?? undefined,
    invoice: invoice ? { reference: invoice.reference, issuedOn: invoice.issuedOn } : undefined,
    origin: m.commitmentId ? 'commitment' : m.balanceCheckId ? 'balanceCheck' : undefined,
  }
  return { reading, draft: movementDraft(m, actorName, labels) }
}

/** Where a commitment is listed: plans with the investments, the others by direction. */
function linkedCommitment(c: Commitment, relation: LinkedCommitment['relation']): LinkedCommitment {
  const kind =
    c.kind === 'investment_plan' ? 'investment_plan' : c.direction === 'incoming' ? 'income' : c.kind
  const page =
    kind === 'investment_plan'
      ? '/investments'
      : kind === 'income'
        ? '/recurring-income'
        : '/recurring-expenses'
  return {
    relation,
    label: c.label,
    kind,
    amount: c.amount,
    currency: c.currency,
    periodUnit: c.periodUnit,
    periodCount: c.periodCount,
    href: `${page}?commitment=${c.id}`,
  }
}
