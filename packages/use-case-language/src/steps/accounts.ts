import type { Money } from '../index.ts'

/** An account as the person reads it in the list of their accounts. */
export interface AccountView {
  institution?: string
  balance: Money
  closed: boolean
}

/** A payment card, told apart by its name; a deferred one carries the two days of its schedule. */
export type CardView =
  | { name: string; expiry: string; debit: 'immediate' }
  | { name: string; expiry: string; debit: 'deferred'; cutOffDay: number; debitDay: number }

/** One cycle of a deferred card: its cut-off, the day the bank really debited it once validated, its total. */
export interface StatementView {
  cutOff: string
  debitedOn?: string
  amount: Money
}

/** A balance check: the balance read that day, the one computed, the gap, and whether an adjustment settled it. */
export interface BalanceCheckView {
  on: string
  declared: Money
  computed: Money
  gap: Money
  settled: boolean
}

/** A balance check, pointed at by its account and the day the balance was read. */
export interface CheckRef {
  account: string
  on: string
}

/** The steps of accounts, cards, card statements, balance checks. */
export interface AccountsSteps {
  createAccount(input: { name: string; opening?: Money; openedOn?: string }): Promise<void>
  readAccountBalance(account: string): Promise<Money>
  /** Corrects what an account says about itself: its name, its institution, its opening. */
  editAccount(input: {
    account: string
    name?: string
    institution?: string
    opening?: Money
    openedOn?: string
  }): Promise<void>
  /** Closes an account today: it keeps its history. */
  closeAccount(account: string): Promise<void>
  reopenAccount(account: string): Promise<void>
  readAccount(account: string): Promise<AccountView>

  /** A card on a current account; its expiry is the month printed on it, `YYYY-MM`. */
  createCard(
    input:
      | { name: string; account: string; expiry: string; debit: 'immediate' }
      | {
          name: string
          account: string
          expiry: string
          debit: 'deferred'
          cutOffDay: number
          debitDay: number
        },
  ): Promise<void>
  editCard(input: { card: string; name?: string; expiry?: string }): Promise<void>
  /** Only a card nothing was paid with. */
  deleteCard(card: string): Promise<void>
  /** The cards that debit an account. */
  readCards(account: string): Promise<CardView[]>
  /** A purchase paid with a card, on the day it was made. */
  declareCardPurchase(input: { card: string; amount: Money; payee: string; on: string }): Promise<void>
  /** The bank debited the statement cut off on `cutOff`, on `debitedOn`. */
  validateStatement(input: { card: string; cutOff: string; debitedOn: string }): Promise<void>
  /** A statement validated by mistake goes back to waiting for its debit. */
  undoStatement(input: { card: string; cutOff: string }): Promise<void>
  /** The statements of a deferred card, most recent first. */
  readCardStatements(card: string): Promise<StatementView[]>

  /** The balance the bank shows today, set against the computed one. */
  recordBalanceCheck(input: { account: string; balance: Money }): Promise<void>
  /** The balance of that check was misread: it is checked again with the right one. */
  correctBalanceCheck(input: CheckRef & { balance: Money }): Promise<void>
  deleteBalanceCheck(check: CheckRef): Promise<void>
  /** Settles the gap of a check in one adjustment, attributed to an actor the person already knows. */
  settleCheckGap(input: CheckRef & { actor: string }): Promise<void>
  /** The checks of an account, most recent first. */
  readBalanceChecks(account: string): Promise<BalanceCheckView[]>
}
