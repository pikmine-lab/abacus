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
  openedOn: string | null
  closedOn: string | null
}

export interface Activity {
  id: string
  userId: string
  name: string
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
}

export type MovementKind = 'transfer' | 'expense' | 'income'

/**
 * Which month a movement counts in. `cash` is the day the money moved, which
 * is what a balance is made of and the only reading a balance ever has.
 * `accrual` is the month the movement is about, declared when the two differ.
 */
export type Reading = 'cash' | 'accrual'

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
}

export type CommitmentKind = 'subscription' | 'financing'
export type CommitmentDirection = 'outgoing' | 'incoming'
export type PeriodUnit = 'week' | 'month' | 'year'
export type Judgment = 'essential' | 'reducible' | 'to_cancel'

export interface Commitment {
  id: string
  userId: string
  kind: CommitmentKind
  direction: CommitmentDirection
  label: string
  actorId: string
  /**
   * The account it hits today. What a commitment hits is a dated history (a
   * recurring payment moves from one account to another on a date), so this is
   * resolved on read; an occurrence reads the account of its own date.
   */
  accountId: string
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
export type InstrumentKind = 'security' | 'crypto' | 'currency'
export type PriceSource = 'yahoo' | 'coingecko'

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
}

/**
 * A holding as its operations make it, valued when a price is known and left
 * unvalued when none is: nothing here is ever estimated.
 */
export interface Position {
  assetId: string
  assetName: string
  instrumentId: string | null
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
