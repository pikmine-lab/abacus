import type { Money } from '../index.ts'

/** An activity as the person declares it: a business one unless said otherwise. */
export interface NewActivity {
  name: string
  kind?: 'business' | 'personal'
  startedOn?: string
  /** The accounts it lives on, by name; a business activity only. */
  accounts?: string[]
  /** The regime as the person names it. */
  regimeLabel?: string
}

/** An activity as it reads back. */
export interface ActivityRead {
  name: string
  kind: 'business' | 'personal'
  regimeLabel: string | null
  closedOn: string | null
  /** The accounts it lives on, by name, in alphabetical order. */
  accounts: string[]
  /** The categories that go against its deductible-expenses policy, in alphabetical order. */
  exceptions: string[]
}

/** An invoice as it is printed: the base excluding VAT, in the currency it is written in, the VAT rate in percent. */
export interface NewInvoice {
  activity: string
  client: string
  reference: string
  issuedOn: string
  dueOn?: string
  base: Money
  vatRate?: string
}

export type InvoiceState = 'pending' | 'overdue' | 'paid' | 'cancelled'

/** An invoice as it reads back: what the client owes, and what reaches the account. */
export interface InvoiceRead {
  client: string
  issuedOn: string
  base: Money
  vat: Money
  receivable: Money
  state: InvoiceState
  /** The day it was cancelled, when it was. */
  cancelledOn?: string
}

/**
 * A rule of a regime, kept to the shape the cases need: a percentage of each
 * period's revenue, payable by the end of the month after the period.
 */
export interface NewLevy {
  activity: string
  name: string
  kind: 'social' | 'income_tax' | 'vat' | 'other'
  validFrom: string
  /** Percent of the revenue. */
  rate: string
  period: 'month' | 'quarter'
  /** The official text the values were read in, and the day it was read. */
  source: Source
  /** The expense category its payments are filed in, an existing one. */
  settledIn?: string
}

export interface Source {
  url: string
  readOn: string
}

/** A rule as it reads back, one row per validity. */
export interface LevyRead {
  name: string
  validFrom: string
  validTo: string | null
  /** Percent, when the rule is a rate. */
  rate: string | null
  /** The labels of its modifiers. */
  modifiers: string[]
}

/** A due date of a rule's schedule: the rule, and the first day of the period it settles. */
export interface DueDate {
  activity: string
  levy: string
  periodStart: string
}

export type DueStatus = 'paid' | 'nil_return' | 'nothing_due' | 'upcoming' | 'overdue'

/** A due date as the schedule reads it. */
export interface DueRead {
  amount: Money
  status: DueStatus
}

/** What one fiscal year of an activity comes to. */
export interface StatementRead {
  revenue: Money
  net: Money
  /** Accrued and not yet paid: money that has to stay on the accounts. */
  reserve: Money
}

/** A dated figure a rule reads and the engine cannot compute. */
export interface ActivityFigure {
  name: string
  validFrom: string
  value: string
}

/** A threshold the regime hinges on: the revenue of the fiscal year so far, at most a value. */
export interface NewThreshold {
  activity: string
  label: string
  value: Money
  consequence: string
}

export interface ThresholdRead {
  label: string
  value: Money
  consequence: string
}

/** A walk of the regime catalog: a place, and the answers in the order the questions come. */
export interface RegimeWalk {
  jurisdiction: string
  /** Each answer by its option's label in the catalog. */
  answers: string[]
}

/** What a regime model would write, before anything is written. */
export interface RegimePreviewRead {
  model: string
  /** The names of the rules it would write, in the catalog's order. */
  rules: string[]
}

/** The steps of activities, invoices, levies, thresholds, regimes. */
export interface BusinessSteps {
  createActivity(input: NewActivity): Promise<void>
  /** Renames an activity and restates its regime label. */
  editActivity(activity: string, changes: { name?: string; regimeLabel?: string }): Promise<void>
  /** States the whole list of accounts an activity lives on. */
  setActivityAccounts(activity: string, accounts: string[]): Promise<void>
  closeActivity(activity: string, on: string): Promise<void>
  reopenActivity(activity: string): Promise<void>
  setActivityExceptions(activity: string, categories: string[]): Promise<void>
  readActivity(activity: string): Promise<ActivityRead>

  declareInvoice(input: NewInvoice): Promise<void>
  /** Corrects what was mistyped: the base, the currency it is written in. */
  correctInvoice(reference: string, changes: { base?: Money; currency?: string }): Promise<void>
  /** The client was reminded, today unless said otherwise. */
  remindInvoice(reference: string, on?: string): Promise<void>
  /** The client will never pay: cancelled, today unless said otherwise. */
  cancelInvoice(reference: string, on?: string): Promise<void>
  /** The client paid what was left, onto that account, on that day. */
  settleInvoice(input: { reference: string; account: string; on: string }): Promise<void>
  readInvoice(reference: string): Promise<InvoiceRead>
  /** The day the client was last reminded, null when never. */
  readInvoiceReminder(reference: string): Promise<string | null>

  createLevy(input: NewLevy): Promise<void>
  /** Corrects a rule's rate in place: the value that was meant all along. */
  correctLevyRate(activity: string, levy: string, rate: string): Promise<void>
  /** The rate changes from a day: the current row closes the day before and a new one starts. */
  supersedeLevy(
    activity: string,
    levy: string,
    input: { from: string; rate: string; source: Source },
  ): Promise<void>
  closeLevy(activity: string, levy: string, on: string): Promise<void>
  deleteLevy(activity: string, levy: string): Promise<void>
  /** A temporary change of a rule: its rate multiplied by a factor for some months. */
  addLevyModifier(
    activity: string,
    levy: string,
    input: { label: string; rateFactor: string; months: number },
  ): Promise<void>
  removeLevyModifier(activity: string, levy: string, label: string): Promise<void>
  readLevies(activity: string): Promise<LevyRead[]>

  readStatement(activity: string, year: number): Promise<StatementRead>
  readDueDate(due: DueDate): Promise<DueRead>
  declareNilReturn(due: DueDate): Promise<void>
  withdrawNilReturn(due: DueDate): Promise<void>
  /** What really left, from that account to that payee, against that due date. */
  payLevy(due: DueDate & { amount: Money; on: string; account: string; payee: string }): Promise<void>

  setActivityFigure(activity: string, figure: ActivityFigure): Promise<void>
  removeActivityFigure(activity: string, figure: { name: string; validFrom: string }): Promise<void>
  readActivityFigures(activity: string): Promise<ActivityFigure[]>

  createThreshold(input: NewThreshold): Promise<void>
  editThreshold(activity: string, label: string, changes: { value: Money }): Promise<void>
  removeThreshold(activity: string, label: string): Promise<void>
  readThresholds(activity: string): Promise<ThresholdRead[]>

  previewRegime(walk: RegimeWalk): Promise<RegimePreviewRead>
  createActivityFromRegime(
    walk: RegimeWalk & { name: string; startedOn: string; accounts: string[] },
  ): Promise<void>
}
