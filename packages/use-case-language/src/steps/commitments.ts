import type { Money } from '../index.ts'

export type Judgment = 'essential' | 'reducible' | 'to_cancel'

/**
 * A commitment as the person reads it in their list: the account it hits,
 * what each occurrence is worth, and when the next one is due. A financing
 * also says what is still owed, a subscription how it was judged, and one
 * someone gave money for, what is left of that reserve.
 */
export interface CommitmentView {
  account: string
  amount: Money
  nextDueOn?: string
  judgment?: Judgment
  remainingDue?: Money
  /** What was received for it and is not drawn yet. */
  reserveLeft?: Money
}

/** One instalment of a financing's written plan. */
export interface Installment {
  dueOn: string
  amount: Money
}

/** The steps of subscriptions, recurring incomes, investment plans, financings and their occurrences. */
export interface CommitmentsSteps {
  /** A monthly subscription, debited from an account. */
  createSubscription(input: {
    label: string
    payee: string
    account: string
    amount: Money
    firstDueOn: string
  }): Promise<void>
  /** A monthly income, credited to an account. */
  createRecurringIncome(input: {
    label: string
    payer: string
    account: string
    amount: Money
    firstDueOn: string
  }): Promise<void>
  /** A monthly placement: a sum leaving an account for an investment account, buying an asset there. */
  createInvestmentPlan(input: {
    label: string
    from: string
    to: string
    asset: string
    amount: Money
    firstDueOn: string
  }): Promise<void>
  /** A purchase paid in monthly instalments, its plan computed from the total. */
  createFinancing(input: {
    label: string
    creditor: string
    account: string
    total: Money
    instalments: number
    firstDueOn: string
  }): Promise<void>
  /** Replaces the plan of a financing with the one given, whole and in order. */
  reviseSchedule(input: { financing: string; plan: Installment[] }): Promise<void>
  readSchedule(financing: string): Promise<Installment[]>
  /** Confirms the oldest occurrence still pending, as expected. */
  confirmOccurrence(commitment: string): Promise<void>
  /** Confirms the oldest pending occurrence of a placement, with the units the order bought. */
  confirmPlacement(input: { plan: string; quantity: string }): Promise<void>
  /** The oldest pending occurrence will not happen: a free month, a paused service. */
  skipOccurrence(commitment: string): Promise<void>
  judgeSubscription(input: { subscription: string; judgment: Judgment }): Promise<void>
  /** Corrects the name a commitment goes by. */
  renameCommitment(input: { commitment: string; label: string }): Promise<void>
  /** From today on, the commitment hits another account. */
  changeCommitmentAccount(input: { commitment: string; account: string }): Promise<void>
  /** From today on, each occurrence is worth that much. */
  changeCommitmentAmount(input: { commitment: string; amount: Money }): Promise<void>
  /** Ends a commitment today: no more occurrences. */
  endCommitment(commitment: string): Promise<void>
  /** Money someone gave for a commitment, held for its coming occurrences. */
  receiveForCommitment(input: {
    commitment: string
    account: string
    payer: string
    amount: Money
    on: string
  }): Promise<void>
  /** A commitment still running, read where the person reads it. */
  readCommitment(label: string): Promise<CommitmentView>
  /** The names of the commitments still running, of every kind, in alphabetical order. */
  readRunningCommitments(): Promise<string[]>
}
