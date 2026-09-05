// Row shapes as the datasources return them (camelCase via the client
// transform). Amounts are strings: they are numeric in PostgreSQL and all
// arithmetic happens in SQL; JavaScript only transports the values.

export type AccountBehavior = 'payment' | 'savings' | 'investment'

export interface Account {
  id: string
  userId: string
  name: string
  institution: string | null
  behavior: AccountBehavior
  currency: string
  /** What the account already held on `openedOn`, before the ledger began. */
  openingBalance: string
  openedOn: string | null
  closedOn: string | null
  /** The activity whose money this is; null for a personal account. */
  activityId: string | null
}

/**
 * `business` has a regime, invoices and a statement; `personal` is an
 * analysis dimension and nothing more. An activity never changes kind or
 * regime: it closes, and a new regime is a new activity.
 */
export type ActivityKind = 'business' | 'personal'
/** Which date brings a receipt into the revenue: the payment or the invoice. */
export type RevenueBasis = 'cash' | 'invoiced'
/** Whether the activity's expenses reduce its profit, exceptions aside. */
export type DeductibleExpenses = 'all' | 'none'

export interface Activity {
  id: string
  userId: string
  name: string
  kind: ActivityKind
  startedOn: string | null
  closedOn: string | null
  fiscalYearStartMonth: number
  fiscalYearStartDay: number
  revenueBasis: RevenueBasis
  vatRegistered: boolean
  defaultVatRate: string | null
  deductibleExpenses: DeductibleExpenses
  /** Free words for the screen; the code never reads them. */
  regimeLabel: string | null
  currency: string
}

export interface Category {
  id: string
  userId: string
  name: string
  groupLabel: string | null
}

export interface Actor {
  id: string
  userId: string
  name: string
  activityId: string | null
  note: string | null
  /** What this client does to an invoice, copied on a new one: the VAT it
   * bears, the withholding it keeps back for the tax office. */
  invoiceVatRate: string | null
  invoiceWithholdingRate: string | null
}

export type MovementKind = 'transfer' | 'expense' | 'income'

/**
 * Which month a movement counts in. `cash` is the day the money moved, which
 * is what a balance is made of and the only reading a balance ever has.
 * `accrual` is the month the movement is about, declared when the two differ.
 */
export type Reading = 'cash' | 'accrual'

/** What a person settled once, and every session then opens in. */
export interface UserPreference {
  userId: string
  reading: Reading
}

export interface Movement {
  id: string
  userId: string
  happenedOn: string
  amount: string
  currency: string
  sourceAccountId: string | null
  sourceActorId: string | null
  targetAccountId: string | null
  targetActorId: string | null
  kind: MovementKind
  categoryId: string | null
  activityId: string | null
  note: string | null
  commitmentId: string | null
  balanceCheckId: string | null
  expectedRefundFromActorId: string | null
  /** What is owed back: a share of the amount, never implicitly all of it. */
  expectedRefundAmount: string | null
  refundClosed: boolean
  refundsMovementId: string | null
  /** What was paid abroad, when the movement was declared in a foreign
   * currency: `amount` is then its EUR counter-value, frozen at declaration. */
  originalAmount: string | null
  originalCurrency: string | null
  /**
   * The month this movement is about, when it is not the month it settled in
   * (a salary paid on the 2nd, a rent paid the month before). First day of
   * that month, or null: never materialised, so an unattached movement follows
   * its date and an attached one survives a date correction.
   */
  accrualMonth: string | null
  /** Resolved by the database: the attachment, or the settlement day's month. */
  countedInMonth: string
  /**
   * Out of every analysis: an exceptional movement (an insurance payout, a
   * regularisation) that would make the month it lands in unreadable. Balances
   * and balance checks still count it, and it stays in the movement list,
   * which is where it is read, corrected and deleted.
   */
  ghost: boolean
  /** The invoice this income pays, when it pays one; several incomes may pay one. */
  invoiceId: string | null
  /** The VAT inside the amount, when the activity is registered and it was stated. */
  vatAmount: string | null
}

export type CommitmentKind = 'subscription' | 'financing' | 'investment_plan'
export type CommitmentDirection = 'outgoing' | 'incoming'
export type PeriodUnit = 'week' | 'month' | 'year'
export type Judgment = 'essential' | 'reducible' | 'to_cancel'

export interface Commitment {
  id: string
  userId: string
  kind: CommitmentKind
  direction: CommitmentDirection
  label: string
  /** Null on an investment plan alone: an internal transfer bills nobody. */
  actorId: string | null
  /**
   * The account it hits today. What a commitment hits is a dated history (a
   * recurring payment moves from one account to another on a date), so this is
   * resolved on read; an occurrence reads the account of its own date.
   */
  accountId: string
  /** Investment plan only: the investment account each occurrence feeds. */
  targetAccountId: string | null
  /** Investment plan only: what each occurrence buys there. */
  assetId: string | null
  /** The move already announced for a later date, when there is one. */
  nextAccountMove: { accountId: string; effectiveOn: string } | null
  categoryId: string | null
  activityId: string | null
  amount: string
  currency: string
  periodUnit: PeriodUnit
  periodCount: number
  nextDueOn: string
  judgment: Judgment | null
  judgmentNote: string | null
  engagedUntil: string | null
  cancelledOn: string | null
  installmentsTotal: number | null
  totalAmount: string | null
}

export type CommitmentEventType =
  | 'created'
  | 'price_changed'
  | 'judgment_changed'
  | 'cancelled'
  | 'account_changed'

export interface CommitmentEvent {
  id: string
  commitmentId: string
  occurredOn: string
  type: CommitmentEventType
  amount: string | null
  /** The currency the amount was stated in that day; a price change can move it. */
  currency: string | null
  note: string | null
  /** account_changed only: the account it hits from that date on. */
  accountId: string | null
}

export interface BalanceCheck {
  id: string
  userId: string
  accountId: string
  checkedOn: string
  declaredBalance: string
  computedBalance: string
  note: string | null
}

/**
 * A quoted thing: public data, owned by nobody, shared by every user. Its
 * identity is where its price comes from and its reference over there.
 */
export type InstrumentKind = 'security' | 'equity' | 'fund' | 'crypto' | 'currency'
export type PriceSource = 'yahoo' | 'coingecko'

/**
 * The mass a holding belongs to, which is what an allocation is read by. The
 * first three come from the price source, the others only from whoever declares
 * an asset no source quotes; `other` also takes a quoted thing whose source has
 * not said what it is yet.
 */
export type AssetNature = 'equity' | 'fund' | 'crypto' | 'bond' | 'real_estate' | 'other'

export interface Instrument {
  id: string
  kind: InstrumentKind
  priceSource: PriceSource
  priceSourceRef: string
  name: string
  symbol: string | null
  isin: string | null
  currency: string
}

/**
 * What a user holds, under the name they give it. An asset without an
 * instrument is one they price by hand: a declared price is a declaration like
 * any other, so it stays private.
 */
export interface Asset {
  id: string
  userId: string
  name: string
  instrumentId: string | null
  /** Declared here only when no instrument answers for it. */
  nature: AssetNature | null
  /** Set only on an asset with no instrument, and always with its day. */
  manualPrice: string | null
  manualPricedOn: string | null
}

export type InvestmentOperationType = 'buy' | 'sell' | 'dividend' | 'fee'

/**
 * What happens inside an investment account. `amount` is what really left or
 * entered its cash, order fees included.
 */
export interface InvestmentOperation {
  id: string
  userId: string
  accountId: string
  assetId: string | null
  type: InvestmentOperationType
  quantity: string | null
  amount: string
  currency: string
  operatedOn: string
  note: string | null
  /** The internal transfer that funded it, when an investment plan wrote both. */
  movementId: string | null
}

/**
 * A holding as its operations make it, valued when a price is known and left
 * unvalued when none is: nothing here is ever estimated.
 */
export interface Position {
  assetId: string
  assetName: string
  instrumentId: string | null
  /** Resolved: the instrument's when there is one, the asset's otherwise. */
  nature: AssetNature
  quantity: string
  /** Weighted average cost of one unit still held (PMP), order fees included. */
  averageCost: string
  /** `quantity x averageCost`: the money still committed to this holding. */
  costBasis: string
  /** Null when no price is known, and then everything below it is null too. */
  price: string | null
  /** When the market made that price, never when it was fetched. */
  pricedAt: Date | null
  /** Typed by hand, so its day is worth showing rather than its hour. */
  manualPrice: boolean
  value: string | null
  /** `value - costBasis`: unrealized, dividends and account fees excluded. */
  gain: string | null
}

/**
 * What was asked of a client and when. Amounts are as written on the invoice;
 * `totalAmount` is what the client owes, `receivableAmount` what reaches the
 * account (base + VAT − withholding). The state is never stored: paid, overdue
 * and cancelled are read from the linked incomes, `dueOn` and `cancelledOn`.
 */
export interface Invoice {
  id: string
  userId: string
  activityId: string
  actorId: string
  reference: string | null
  issuedOn: string
  dueOn: string | null
  currency: string
  baseAmount: string
  vatRate: string
  vatAmount: string
  withholdingRate: string
  withholdingAmount: string
  totalAmount: string
  receivableAmount: string
  note: string | null
  remindedOn: string | null
  cancelledOn: string | null
}

/** One thing the activity owes, described entirely in data (see domain/levy.ts). */
export type LevyKind = 'social' | 'income_tax' | 'vat' | 'other'
export type LevyStatus = 'confirmed' | 'extended_by_default' | 'unconfirmed'
export type LevyMeasure =
  | 'revenue'
  | 'revenue_incl_vat'
  | 'expenses'
  | 'profit'
  | 'vat_balance'
  | 'withholdings'
  | 'paid'
  | 'amount'
  | 'input'
  | 'none'
export type PeriodRef = 'current' | 'ytd' | 'year-1' | 'year-2' | 'rolling-12'
export type BaseScale = 'none' | 'per_month' | 'annualized'
export type AmountForm = 'rate' | 'brackets' | 'elective_base' | 'fixed' | 'none'
export type LevyPeriod = 'month' | 'quarter' | 'half' | 'year'
export type Regularization = 'none' | 'annual_deadzone' | 'provisional_then_settled'

export interface Levy {
  id: string
  userId: string
  activityId: string
  name: string
  kind: LevyKind
  validFrom: string
  validTo: string | null
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
  status: LevyStatus
  baseMeasure: LevyMeasure
  baseLevyId: string | null
  baseInputName: string | null
  basePeriodRef: PeriodRef
  baseCoefficient: string | null
  /** Validated shape: `Abatement` in domain/levy.ts. */
  baseAbatement: unknown | null
  baseAddBackLevyIds: string[] | null
  baseFloor: string | null
  baseCap: string | null
  /** Validated shape: `Credit[]` in domain/levy.ts. */
  baseCredits: unknown | null
  baseScale: BaseScale
  amountForm: AmountForm
  rate: string | null
  /** Validated shape: `Brackets` in domain/levy.ts. */
  brackets: unknown | null
  /** Validated shape: `Elective` in domain/levy.ts. */
  elective: unknown | null
  fixedAmount: string | null
  fixedInputName: string | null
  fixedCredit: string | null
  creditInputName: string | null
  period: LevyPeriod
  /** Validated shape: `Due` in domain/levy.ts. */
  due: unknown
  declarationLagMonths: number | null
  firstDueAfterDays: number | null
  /** Validated shape: `SkipPeriods` in domain/levy.ts. */
  skipPeriods: unknown | null
  regularization: Regularization
  /** Validated shape: `RegularizationParams` in domain/levy.ts. */
  regularizationParams: unknown | null
  settlementCategoryId: string | null
  deductible: boolean
  passThrough: boolean
  note: string | null
}

export type ModifierEffect = 'rate_factor' | 'replace_amount' | 'coefficient' | 'exempt'

/** What changes a levy for a time; eligibility is the user's assertion. */
export interface LevyModifier {
  id: string
  levyId: string
  label: string
  effect: ModifierEffect
  value: string | null
  startsOn: string | null
  durationMonths: number | null
  durationPeriods: number | null
  endsOn: string | null
  condition: string | null
  sourceUrl: string | null
  verifiedOn: string | null
  status: LevyStatus
}

/** A dated figure the engine cannot compute and the user states. */
export interface ActivityInput {
  id: string
  userId: string
  activityId: string
  name: string
  validFrom: string
  value: string
  note: string | null
}

export type ThresholdMeasure =
  | Exclude<LevyMeasure, 'paid' | 'amount' | 'input' | 'none'>
  | 'withholding_share'

/** A measure the regime hinges on, and what changes past the value. It alerts, never switches. */
export interface Threshold {
  id: string
  userId: string
  activityId: string
  label: string
  measure: ThresholdMeasure
  periodRef: PeriodRef
  comparison: 'lte' | 'gte'
  value: string
  consequence: string
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
}
