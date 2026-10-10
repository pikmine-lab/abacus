import { addPeriod } from '@abacus/core/domain/period'
import { cardStatements, confirmStatement, createCard } from '@abacus/core/services/cards'
import { daysAgo, TODAY } from './calendar.ts'
import type { Ledger } from './ledger.ts'

/**
 * A deferred card on the current account, which is where most daily spending
 * goes, and an immediate one on the business account. The business card
 * expires next month, so the screen that reminds what to move onto a renewed
 * card has something to say.
 */
export async function cards(userId: string, { accounts }: Ledger) {
  const deferred = await createCard(userId, {
    name: 'Carte Visa',
    accountId: accounts.checking,
    expiryMonth: addPeriod(TODAY, 'year', 2).slice(0, 7),
    debitMode: 'deferred',
    statementDay: 25,
    statementShift: 'none',
    debitDay: 31,
    debitShift: 'previous',
  })
  const business = await createCard(userId, {
    name: 'Carte pro',
    accountId: accounts.business,
    expiryMonth: addPeriod(TODAY, 'month', 1).slice(0, 7),
    debitMode: 'immediate',
  })
  return { deferred: deferred.id, business: business.id }
}

export type Cards = Awaited<ReturnType<typeof cards>>

/**
 * States the debit of every statement the bank has taken, as the person does
 * when the statement shows on the account. The last few days are left alone:
 * a statement debited this week still waits for its validation, which is the
 * state the card screen exists to show.
 */
export async function validateStatements(userId: string, { deferred }: Cards): Promise<void> {
  for (const statement of await cardStatements(userId, deferred))
    if (statement.debitedOn === null && statement.dueOn <= daysAgo(4))
      await confirmStatement(userId, statement.id, statement.dueOn)
}
