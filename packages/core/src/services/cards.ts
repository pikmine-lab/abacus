import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import {
  cardReferences,
  dateOnStatement,
  deleteCardRow,
  dropEmptyStatements,
  getCard,
  getStatement,
  insertCard,
  listCards as listCardsDs,
  listStatements,
  pendingPurchases,
  placePurchase,
  type StatementWithTotal,
  setStatementDebit,
  statementFor,
  updateCardRow,
} from '../db/datasources/cards.ts'
import { cycleOf } from '../domain/card.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { Card, DayShift, DebitMode } from '../domain/types.ts'
import { monthStart } from './movements.ts'

/**
 * A payment card, declared so that a movement can say what paid it. The card
 * never carries its number: its name is how the person tells it apart.
 *
 * A deferred card is what the model needs to know about: its purchases leave
 * the account on a later day, all at once, and a movement dated on its
 * purchase day would lower the balance before the bank does. So the card
 * carries its schedule (the cut-off day that closes a cycle and the day the
 * total is debited, each with its way off a weekend), and its purchases are
 * grouped in statements, one per cycle, dated on the debit the schedule
 * expects until the person states the day the bank really took it (see
 * declareMovementIn and confirmStatement).
 *
 * A card debits an open current account, never a savings or an investment one. It
 * has no closing: its expiry month says when it stops working, and a purchase
 * dated after it is refused, which is what makes a renewal get typed in.
 */
export interface CardInput {
  name: string
  accountId: string
  /** "YYYY-MM", the month printed on the card. */
  expiryMonth: string
  debitMode: DebitMode
  /** Deferred only: days of the month (31 reads "end of month") and their way off a weekend. */
  statementDay?: number
  statementShift?: DayShift
  debitDay?: number
  debitShift?: DayShift
}

const SHIFTS: DayShift[] = ['none', 'previous', 'next']

/** The schedule a mode calls for: all four fields on a deferred card, none on an immediate one. */
function checkSchedule(input: {
  debitMode: DebitMode
  statementDay?: number | null
  statementShift?: DayShift | null
  debitDay?: number | null
  debitShift?: DayShift | null
}): void {
  const given = [input.statementDay, input.statementShift, input.debitDay, input.debitShift].filter(
    (v) => v !== undefined && v !== null,
  ).length
  if (input.debitMode === 'immediate') {
    if (given > 0)
      throw new DomainError(
        'schedule_on_immediate',
        'An immediate-debit card debits each purchase on its day: it has no cut-off or debit day',
      )
    return
  }
  if (given < 4)
    throw new DomainError(
      'deferred_needs_schedule',
      'A deferred-debit card needs its cut-off day and its debit day, each with its way off a weekend',
    )
  for (const day of [input.statementDay!, input.debitDay!])
    if (!Number.isInteger(day) || day < 1 || day > 31)
      throw new DomainError(
        'bad_card_day',
        `${day} is not a day of the month: give 1 to 31 (31 is the month's end)`,
      )
  for (const shift of [input.statementShift!, input.debitShift!])
    if (!SHIFTS.includes(shift))
      throw new DomainError('bad_card_shift', `"${shift}" is not a weekend rule: none, previous or next`)
}

async function requirePaymentAccount(tx: Executor, userId: string, accountId: string): Promise<void> {
  const account = await getAccount(tx, userId, accountId)
  if (!account) throw new DomainError('account_not_found', `No account ${accountId} for this user`)
  if (account.behavior !== 'payment')
    throw new DomainError(
      'card_needs_payment_account',
      `"${account.name}" is not a current account: a card debits a current account`,
    )
  if (account.closedOn)
    throw new DomainError('account_closed', `"${account.name}" is closed: reopen it before writing to it`)
}

export async function createCard(userId: string, input: CardInput): Promise<Card> {
  checkSchedule(input)
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      await requirePaymentAccount(tx, userId, input.accountId)
      return await insertCard(tx, {
        userId,
        name: input.name,
        accountId: input.accountId,
        expiryMonth: monthStart(input.expiryMonth),
        debitMode: input.debitMode,
        statementDay: input.statementDay,
        statementShift: input.statementShift,
        debitDay: input.debitDay,
        debitShift: input.debitShift,
      })
    })
  } catch (e) {
    rethrowUnique(e, 'card_exists', `A card already uses the name "${input.name}"`)
  }
}

export type { StatementWithTotal }

export type CardWithStatements = Card & {
  /** The statements with no debit day stated yet, oldest cycle first. */
  pending: StatementWithTotal[]
}

/**
 * The cards, by name, each with its statements still waiting for their debit
 * day: what a deferred card has bought and the bank has not taken, as far as
 * the ledger knows. That money is still on the account, which is exactly what
 * its balance says.
 */
export async function listCards(userId: string): Promise<CardWithStatements[]> {
  const sql = db()
  const [cards, pending] = await Promise.all([
    listCardsDs(sql, userId),
    listStatements(sql, userId, { pendingOnly: true }),
  ])
  return cards.map((card) => ({
    ...card,
    pending: pending.filter((s) => s.cardId === card.id).reverse(),
  }))
}

/** Every statement of a card, most recent cycle first: what its history panel shows and repairs. */
export async function cardStatements(userId: string, cardId: string): Promise<StatementWithTotal[]> {
  return await listStatements(db(), userId, { cardId })
}

/**
 * States the day the bank debited a statement, which moves every purchase of
 * its cycle onto that day and into the balances. Stated again, it corrects the
 * day; null takes the statement back to waiting, off the balances again.
 *
 * Only a day the debit can have happened on: not before the cut-off that
 * closes the cycle, and not after today, since what is stated is a debit the
 * bank has made. What was debited is not asked: it is the sum of the
 * purchases, and a total that disagrees with the bank's means a purchase to
 * correct, which is a movement's business.
 */
export async function confirmStatement(
  userId: string,
  statementId: string,
  debitedOn: string | null,
): Promise<StatementWithTotal> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const statement = await getStatement(tx, userId, statementId)
    if (!statement)
      throw new DomainError('statement_not_found', `No card statement ${statementId} for this user`)
    if (debitedOn !== null) {
      if (debitedOn > today())
        throw new DomainError(
          'statement_debit_ahead',
          `${debitedOn} has not come yet: a statement is validated once the bank has debited it`,
        )
      if (debitedOn < statement.cutOffOn)
        throw new DomainError(
          'statement_debit_before_cut_off',
          `The cycle of "${statement.cardName}" closes on ${statement.cutOffOn}: it cannot be debited before`,
        )
    }
    await setStatementDebit(tx, statementId, debitedOn)
    await dateOnStatement(tx, statementId)
    return (await listStatements(tx, userId, { cardId: statement.cardId })).find((s) => s.id === statementId)!
  })
}

/**
 * Moves every purchase still waiting for its debit onto the statement its card
 * now gives it, or back to its own day when the card no longer defers. The
 * statements left empty go.
 */
async function replacePending(tx: Executor, card: Card): Promise<void> {
  for (const purchase of await pendingPurchases(tx, card.id))
    await placePurchase(
      tx,
      purchase.id,
      card.debitMode === 'deferred'
        ? { statement: await statementFor(tx, card.id, cycleOf(card, purchase.purchasedOn)) }
        : { purchasedOn: purchase.purchasedOn },
    )
  await dropEmptyStatements(tx, card.id)
}

/** Fields a correction may touch; anything absent keeps its current value. */
export type CardEdit = Partial<CardInput>

/**
 * Corrects a card. Its account only changes while nothing names the card: the
 * movements it paid left the account it was on, and a card moved elsewhere
 * would contradict them.
 *
 * A new schedule, or a new mode, moves the purchases still waiting for their
 * debit onto the statements the card now gives: their statement was drawn from
 * the schedule, and a schedule typed wrongly would otherwise keep them in the
 * wrong cycle. A statement whose debit was stated keeps its purchases, since
 * the bank has said when it happened.
 */
export async function editCard(userId: string, id: string, input: CardEdit): Promise<Card> {
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const card = await getCard(tx, userId, id)
      if (!card) throw new DomainError('card_not_found', `No card ${id} for this user`)
      const debitMode = input.debitMode ?? card.debitMode
      // Switching mode replaces the schedule rather than merging into it: an
      // immediate card keeps none, a deferred one states the four fields anew.
      const keep = debitMode === card.debitMode
      const schedule = {
        statementDay: input.statementDay ?? (keep ? card.statementDay : null),
        statementShift: input.statementShift ?? (keep ? card.statementShift : null),
        debitDay: input.debitDay ?? (keep ? card.debitDay : null),
        debitShift: input.debitShift ?? (keep ? card.debitShift : null),
      }
      checkSchedule({ debitMode, ...schedule })
      if (input.accountId !== undefined && input.accountId !== card.accountId) {
        await requirePaymentAccount(tx, userId, input.accountId)
        const refs = await cardReferences(tx, id)
        if (refs.movements + refs.commitments > 0)
          throw new DomainError(
            'card_in_use',
            `"${card.name}" already paid ${refs.movements} movement(s) and bills ${refs.commitments} subscription(s): its account cannot change`,
          )
      }
      const updated = (await updateCardRow(tx, userId, id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.accountId !== undefined && { accountId: input.accountId }),
        ...(input.expiryMonth !== undefined && { expiryMonth: monthStart(input.expiryMonth) }),
        debitMode,
        ...schedule,
      }))!
      // A rename or a new expiry leaves every purchase where it is.
      const rescheduled =
        debitMode !== card.debitMode ||
        (Object.keys(schedule) as (keyof typeof schedule)[]).some((key) => schedule[key] !== card[key])
      if (rescheduled) await replacePending(tx, updated)
      return updated
    })
  } catch (e) {
    rethrowUnique(e, 'card_exists', `A card already uses the name "${input.name}"`)
  }
}

/**
 * Removes a card nothing names. Once a movement says it was paid with it, the
 * card is part of why that movement is dated where it is, and removing it would
 * leave the date unexplained: it stays, its expiry saying it no longer works.
 */
export async function deleteCard(userId: string, id: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    const card = await getCard(tx, userId, id)
    if (!card) throw new DomainError('card_not_found', `No card ${id} for this user`)
    const refs = await cardReferences(tx, id)
    if (refs.movements + refs.commitments > 0)
      throw new DomainError(
        'card_in_use',
        `"${card.name}" paid ${refs.movements} movement(s) and bills ${refs.commitments} subscription(s): it cannot be deleted`,
      )
    await deleteCardRow(tx, userId, id)
  })
}
