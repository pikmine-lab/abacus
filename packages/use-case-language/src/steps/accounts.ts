import type { Money } from '../index.ts'

/** The steps of accounts, cards, card statements, balance checks. */
export interface AccountsSteps {
  createAccount(input: { name: string; opening?: Money; openedOn?: string }): Promise<void>
  readAccountBalance(account: string): Promise<Money>
}
