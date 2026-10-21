import type { Money } from '../index.ts'

/** The steps of movements and their links. */
export interface LedgerSteps {
  declareExpense(input: { account: string; amount: Money; payee: string; on: string }): Promise<void>
}
