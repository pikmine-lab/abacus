import type { Account, Activity, Actor, Card, Category, Movement } from '@abacus/core/domain'
import type { CardWithStatements } from '@abacus/core/services/cards'
import type { CardChoice } from '@/components/card-forms'
import type { MovementDraft } from '@/components/movement-form'

/**
 * What the movement panel offers, shared by every page that declares or
 * corrects a movement: the ledger and a card's own page correct the same
 * movements, with the same choices.
 */
export function movementFormOptions({
  accounts,
  actors,
  categories,
  activities,
  cards,
}: {
  accounts: Account[]
  actors: Actor[]
  categories: Category[]
  activities: Activity[]
  cards: CardWithStatements[]
}) {
  return {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    // Only a business activity registered for VAT reclaims any, and only
    // there does an expense say how much of it was VAT.
    activities: activities.map((a) => ({
      id: a.id,
      name: a.name,
      vatRegistered: a.kind === 'business' && a.vatRegistered,
      defaultVatRate: a.defaultVatRate === null ? undefined : Number(a.defaultVatRate),
    })),
    cards: cardChoices(cards),
  }
}

/** The cards as a form paying with one needs them: whose account, and when it debits. */
export function cardChoices(cards: Card[]): CardChoice[] {
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    accountId: c.accountId,
    debitMode: c.debitMode,
    statementDay: c.statementDay,
    statementShift: c.statementShift,
    debitDay: c.debitDay,
    debitShift: c.debitShift,
  }))
}

/** A declared movement, flattened for the correction panel. */
export function movementDraft(m: Movement, actorName: Map<string, string>): MovementDraft {
  const isTransfer = m.kind === 'transfer'
  const isIncome = m.kind === 'income'
  return {
    id: m.id,
    type: m.kind,
    // The day the person knows: a deferred card derives its debit from it.
    happenedOn: m.purchasedOn ?? m.happenedOn,
    cardId: m.cardId ?? undefined,
    amount: Number(m.amount).toFixed(2),
    originalAmount: m.originalAmount ? Number(m.originalAmount).toFixed(2) : undefined,
    originalCurrency: m.originalCurrency ?? undefined,
    accountId: (isIncome ? m.targetAccountId : m.sourceAccountId) ?? '',
    toAccountId: isTransfer ? (m.targetAccountId ?? undefined) : undefined,
    actorName: isTransfer ? undefined : actorName.get((isIncome ? m.sourceActorId : m.targetActorId)!),
    categoryId: m.categoryId ?? undefined,
    activityId: m.activityId ?? undefined,
    note: m.note ?? undefined,
    accrualMonth: m.accrualMonth?.slice(0, 7),
    ghost: m.ghost,
    refundFromActorName: m.expectedRefundFromActorId
      ? (actorName.get(m.expectedRefundFromActorId) ?? '')
      : undefined,
    expectedRefundAmount: m.expectedRefundAmount ? Number(m.expectedRefundAmount) : undefined,
    vatAmount: m.vatAmount === null ? undefined : Number(m.vatAmount).toFixed(2).replace('.', ','),
    origin: m.commitmentId
      ? 'Ce mouvement vient d’une échéance confirmée.'
      : m.balanceCheckId
        ? 'Ce mouvement est un ajustement de pointage.'
        : undefined,
  }
}
