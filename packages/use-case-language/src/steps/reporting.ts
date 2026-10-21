import type { Money } from '../index.ts'

/** What a breakdown of the flows ranks: a category, its group, an actor, an activity. */
export type FlowDimension = 'category' | 'categoryGroup' | 'actor' | 'activity'

/**
 * One row of a breakdown: what it is about, null for what carries none, and
 * what it comes to: the net of refunds for spending, the amount received for
 * income.
 */
export interface FlowRow {
  label: string | null
  amount: Money
}

export type Reading = 'cash' | 'accrual'
export type RankingView = 'strip' | 'bars'
/** A language the app speaks, or null when it follows the browser's. */
export type Language = 'fr' | 'en' | null

export interface Preferences {
  reading: Reading
  rankingView: RankingView
  language: Language
}

/** The steps of overview, flows, lists, preferences. */
export interface ReportingSteps {
  /** A month's flows, `YYYY-MM`, on one side of the ledger, broken down and ranked biggest first. */
  readFlows(input: { kind: 'expense' | 'income'; by: FlowDimension; month: string }): Promise<FlowRow[]>
  /** What the person owns: every account's balance, and the holdings at their last known price. */
  readWealth(): Promise<Money>

  readPreferences(): Promise<Preferences>
  setReadingPreference(reading: Reading): Promise<void>
  setRankingViewPreference(view: RankingView): Promise<void>
  setLanguagePreference(language: Language): Promise<void>
}
