import type { Money } from '../index.ts'
import type { MovementRef } from './ledger.ts'

/** One person's share of an expense, pointed at by the expense and the person. */
export interface ShareRef {
  expense: MovementRef
  debtor: string
}

/** A claim still awaited, as the person reads it. */
export interface OpenClaim {
  debtor: string
  /** The expense it was advanced on. */
  expense: MovementRef
  remaining: Money
  /** The next payment the debtor's plan expects, when they gave one. */
  nextDue?: { on: string; amount: Money }
}

/** The steps of shares advanced for others, their plans, closings and claims. */
export interface AdvancesSteps {
  /** The debtor paid their share back, in full or in part, on that day. */
  refundShare(input: ShareRef & { amount: Money; on: string }): Promise<void>
  /** Nobody owes that share any more: what came back of it becomes a plain income. */
  removeShare(share: ShareRef): Promise<void>
  /** The debtor said when they would pay: equal monthly payments from a first day. */
  planShare(input: ShareRef & { count: number; firstDueOn: string }): Promise<void>
  dropSharePlan(share: ShareRef): Promise<void>
  /** What is left of the share will never come back. */
  writeOffShare(share: ShareRef): Promise<void>
  readOpenClaims(): Promise<OpenClaim[]>
}
