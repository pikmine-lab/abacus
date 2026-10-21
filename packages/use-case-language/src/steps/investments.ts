import type { Money } from '../index.ts'

/** What a market search finds: a listed instrument, its ticker, and its price in the currency it is quoted in. */
export interface FoundInstrument {
  name: string
  ticker: string
  price: Money
}

/** What no market quotes is read under the nature its holder gives it. */
export type AssetNature = 'equity' | 'fund' | 'bond' | 'real_estate' | 'other'

export type OperationType = 'buy' | 'sell' | 'dividend' | 'fee'

/**
 * Something that happened inside an investment account. A quantity is a
 * decimal string ("10", "12.5"), only on a purchase or a sale; an account fee
 * is about no asset.
 */
export interface Operation {
  account: string
  type: OperationType
  asset?: string
  quantity?: string
  amount: Money
  on: string
}

/** Which operation a correction or a deletion is about: the person names it by what it was. */
export interface OperationRef {
  type: OperationType
  asset?: string
  on: string
}

/** An asset followed, not held, with its last known price in euros, or null when it has none. */
export interface FollowedAsset {
  name: string
  price: Money | null
}

/**
 * A holding: its weighted average cost per unit, order fees included, and,
 * at the last known price in euros, what it is worth and its unrealized gain;
 * those three are null when it has no price.
 */
export interface Position {
  asset: string
  quantity: string
  averageCost: Money
  price: Money | null
  value: Money | null
  gain: Money | null
}

/** An investment account: its cash, and what it is worth with its holdings. */
export interface InvestmentAccountValue {
  account: string
  cash: Money
  value: Money
}

/** One day of the portfolio: what it was worth, what had been put in, and the difference. */
export interface ValuationDay {
  on: string
  value: Money
  contributions: Money
  performance: Money
}

/** The steps of assets, operations, prices, portfolio, instruments. */
export interface InvestmentsSteps {
  createInvestmentAccount(input: { name: string; opening?: Money; openedOn?: string }): Promise<void>
  searchInstruments(query: string): Promise<FoundInstrument[]>
  /** Follows the instrument a search for `query` finds under that ticker, held under the name `as`. */
  followInstrument(input: { query: string; ticker: string; as: string }): Promise<void>
  /** Follows something no market quotes, priced by hand. */
  followUnquotedAsset(input: { name: string; nature: AssetNature }): Promise<void>
  setAssetPrice(input: { asset: string; price: Money; on: string }): Promise<void>
  renameAsset(input: { asset: string; to: string }): Promise<void>
  stopFollowing(asset: string): Promise<void>
  /** Brings the prices of what the person holds or follows up to date, as far as the market allows. */
  refreshPrices(): Promise<void>
  readFollowedAssets(): Promise<FollowedAsset[]>
  recordOperation(operation: Operation): Promise<void>
  correctOperation(
    operation: OperationRef,
    changes: { amount?: Money; quantity?: string; on?: string },
  ): Promise<void>
  deleteOperation(operation: OperationRef): Promise<void>
  /** Every operation, most recent first, without the account it was on. */
  readOperations(): Promise<Omit<Operation, 'account'>[]>
  readPositions(): Promise<Position[]>
  readInvestmentAccounts(): Promise<InvestmentAccountValue[]>
  /** The valuation history over everything since the first operation: its first and its last day. */
  readValuationHistory(): Promise<{ first: ValuationDay; last: ValuationDay }>
}
