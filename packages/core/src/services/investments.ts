import { db, type Executor } from '../db/client.ts'
import { getAccount, listAccountsWithBalance } from '../db/datasources/accounts.ts'
import {
  assetHistory as assetHistoryDs,
  assetPrices as assetPricesDs,
  countOperationsForAsset,
  deleteAssetRow,
  deleteOperationRow,
  earliestOperationDate,
  findAssetByInstrument,
  getAsset,
  getOperation,
  hasPriceHistory,
  heldQuantity,
  insertAsset,
  insertOperation,
  insertPriceHistory,
  instrumentsToRefresh,
  listAssets as listAssetsDs,
  listInstruments,
  listOperations as listOperationsDs,
  lowestRunningQuantity,
  type NewInstrument,
  netContributionsPerAccount,
  type OperationQuery,
  type OperationSortField,
  type PositionSortField,
  positions as positionsDs,
  setInstrumentCurrency,
  setInstrumentKind,
  updateAssetRow,
  updateOperationRow,
  upsertAssetPrice,
  upsertClose,
  upsertInstrument,
  upsertQuote,
  type ValuationPoint,
  valuationSeries,
} from '../db/datasources/investments.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { natureOf } from '../domain/nature.ts'
import { today } from '../domain/period.ts'
import type { SortChoice, SortFields } from '../domain/sort.ts'
import type {
  Account,
  Asset,
  AssetNature,
  Instrument,
  InvestmentOperation,
  InvestmentOperationType,
  Position,
} from '../domain/types.ts'
import {
  CLOSED_FRESHNESS_MS,
  type Fetcher,
  FRESHNESS_MS,
  fetchHistory,
  fetchQuote,
  type HistoryFetcher,
  type Quote,
} from '../prices/sources.ts'
import { eurRateOn, eurRatesFor, toEurSeries } from './fx.ts'

export interface DeclareAssetInput {
  name: string
  /** Absent for something priced by hand: unlisted shares, an SCPI, a property. */
  instrument?: NewInstrument
  /**
   * The mass it belongs to, and only for an asset with no instrument: a quoted
   * one is typed by its source, at declaration and again at every price read.
   */
  nature?: AssetNature
}

/**
 * Declares what the user holds, or follows: an asset with no operation on it is
 * simply one being watched, and buying some later turns it into a position with
 * nothing to redeclare.
 *
 * The instrument behind it is shared with every other user, so it is looked up
 * by its identity before being created: holding the same ETF as someone else
 * must not duplicate the thing whose price we read. And declaring the same
 * instrument twice **returns what is already there** rather than failing: one
 * instrument is one holding (two names would split a position in half), so the
 * second declaration has nothing left to do. That also makes declaring an asset
 * and an operation together safe to retry.
 *
 * Its nature is asked for only when no source can say it. Given alongside a
 * source it is refused rather than dropped: the source is the authority there,
 * and an accepted-then-ignored declaration would read as a stored fact.
 */
export async function declareAsset(userId: string, input: DeclareAssetInput): Promise<Asset> {
  if (input.instrument && input.nature)
    throw new DomainError(
      'nature_comes_from_source',
      'A quoted asset is typed by its price source: leave the nature out, or drop the source',
    )
  const sql = db()
  return await sql.begin(async (tx) => {
    const instrument = input.instrument ? await upsertInstrument(tx, input.instrument) : null
    if (instrument) {
      const existing = await findAssetByInstrument(tx, userId, instrument.id)
      if (existing) return existing
    }
    try {
      // Unclassified is what "other" says, so an asset declared without a
      // nature still lands in a mass rather than in no list at all.
      return await insertAsset(
        tx,
        userId,
        input.name,
        instrument?.id ?? null,
        instrument ? null : (input.nature ?? 'other'),
      )
    } catch (e) {
      rethrowUnique(e, 'asset_exists', `You already hold something named "${input.name}"`)
    }
  })
}

/**
 * Everything the user holds or follows, each with the instrument behind it and
 * the mass it belongs to. The mass is resolved here rather than left to the
 * callers: a followed asset carries no position, so nothing else would resolve
 * it, and the watchlist mixes natures exactly as a portfolio does.
 */
export async function listAssets(
  userId: string,
): Promise<(Omit<Asset, 'nature'> & { instrument: Instrument | null; nature: AssetNature })[]> {
  const sql = db()
  const assets = await listAssetsDs(sql, userId)
  const instruments = await listInstruments(sql, [
    ...new Set(assets.map((a) => a.instrumentId).filter((id): id is string => id !== null)),
  ])
  const byId = new Map(instruments.map((i) => [i.id, i]))
  return assets.map((a) => {
    const instrument = a.instrumentId ? (byId.get(a.instrumentId) ?? null) : null
    return { ...a, instrument, nature: natureOf(instrument?.kind ?? null, a.nature) }
  })
}

/**
 * Renames a holding. Only its name: the instrument behind it is what it is, and
 * pointing an asset at another instrument would make its whole history describe
 * something else.
 */
export async function editAsset(userId: string, id: string, name: string): Promise<Asset> {
  try {
    const asset = await updateAssetRow(db(), userId, id, { name })
    if (!asset) throw new DomainError('asset_not_found', `No asset ${id} for this user`)
    return asset
  } catch (e) {
    rethrowUnique(e, 'asset_exists', `You already hold something named "${name}"`)
  }
}

/**
 * Stops following an asset, which is only ever an asset nothing happened on:
 * one that carries operations is part of the history, and forgetting it would
 * take a position and its cost with it. The shared instrument stays: it belongs
 * to no one, and someone else may well be following it.
 */
export async function stopFollowing(userId: string, assetId: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    const asset = await getAsset(tx, userId, assetId)
    if (!asset) throw new DomainError('asset_not_found', `No asset ${assetId} for this user`)
    const operations = await countOperationsForAsset(tx, assetId)
    if (operations > 0)
      throw new DomainError(
        'asset_has_operations',
        `"${asset.name}" carries ${operations} operation${operations > 1 ? 's' : ''}: delete those first, or keep it`,
      )
    await deleteAssetRow(tx, userId, assetId)
  })
}

export interface RecordOperationInput {
  accountId: string
  assetId?: string
  type: InvestmentOperationType
  quantity?: number
  /** What left or entered the account. Omit it to give `unitPrice` instead. */
  amount?: number
  /**
   * The price of one unit, which is what a broker displays: the total is then
   * `quantity x unitPrice`, rounded to the cent. Reconstructing a total from a
   * valuation instead would fold the difference between two venues' prices into
   * the cost basis, and leave it there for as long as the holding is held.
   */
  unitPrice?: number
  operatedOn: string
  note?: string
}

/** The total of an operation, however it was expressed. */
function totalOf(input: RecordOperationInput): number {
  if (input.amount !== undefined && input.unitPrice !== undefined)
    throw new DomainError(
      'amount_or_unit_price',
      'Give either the total amount or the unit price, not both: they would contradict each other',
    )
  if (input.unitPrice !== undefined) {
    if (!(input.quantity && input.quantity > 0))
      throw new DomainError('needs_quantity', 'A unit price needs the quantity it applies to')
    return Math.round(input.unitPrice * input.quantity * 100) / 100
  }
  if (input.amount === undefined)
    throw new DomainError('bad_amount', 'An operation needs its amount, or a unit price and a quantity')
  return input.amount
}

/**
 * Records what happened inside investment accounts, as a batch and in one
 * transaction: a buy and the fee that came with it are one declaration, and half
 * of it landing would leave a position that never existed.
 */
export async function recordOperations(
  userId: string,
  inputs: RecordOperationInput[],
): Promise<InvestmentOperation[]> {
  if (inputs.length === 0)
    throw new DomainError('no_operations', 'There is nothing to record: pass at least one operation')
  const sql = db()
  return await sql.begin(async (tx) => {
    const recorded: InvestmentOperation[] = []
    for (const input of inputs) recorded.push(await recordOperationIn(tx, userId, input))
    return recorded
  })
}

async function recordOperationIn(
  tx: Executor,
  userId: string,
  input: RecordOperationInput,
): Promise<InvestmentOperation> {
  const account = await getAccount(tx, userId, input.accountId)
  if (!account) throw new DomainError('account_not_found', `No account ${input.accountId} for this user`)
  if (account.behavior !== 'investment')
    throw new DomainError(
      'not_an_investment_account',
      `"${account.name}" is not an investment account: only those carry operations`,
    )
  if (account.closedOn)
    throw new DomainError('account_closed', `"${account.name}" is closed: reopen it before writing to it`)
  const amount = totalOf(input)
  if (!(amount > 0)) throw new DomainError('bad_amount', 'An amount is always positive')

  const trade = input.type === 'buy' || input.type === 'sell'
  if (trade && !(input.quantity && input.quantity > 0))
    throw new DomainError('needs_quantity', 'A buy or a sell needs the quantity it moved')
  if (!trade && input.quantity !== undefined)
    throw new DomainError('unexpected_quantity', 'Only a buy or a sell moves a quantity')
  if ((trade || input.type === 'dividend') && !input.assetId)
    throw new DomainError('needs_asset', `A ${input.type} needs the asset it is about`)

  if (input.assetId) {
    const asset = await getAsset(tx, userId, input.assetId)
    if (!asset) throw new DomainError('asset_not_found', `No asset ${input.assetId} for this user`)
  }
  // Selling more than the account holds would leave a negative position, which
  // is not something that happens: it is a typo in the quantity or the account.
  if (input.type === 'sell') {
    const held = Number(await heldQuantity(tx, userId, input.accountId, input.assetId!))
    if (input.quantity! > held)
      throw new DomainError(
        'oversold',
        `"${account.name}" holds ${held} of that asset, less than the ${input.quantity} being sold`,
      )
  }

  return await insertOperation(tx, {
    userId,
    accountId: input.accountId,
    assetId: input.assetId ?? null,
    type: input.type,
    quantity: trade ? String(input.quantity) : null,
    amount: String(amount),
    operatedOn: input.operatedOn,
    note: input.note ?? null,
  })
}

/**
 * What a list of operations offers to be ordered on, and what each criterion
 * opens on. The date, most recent first, stays the default: a journal is read
 * as a history before it is read as a ranking.
 */
/** The criteria the two investment lists offer, as both interfaces read them. */
export type { OperationQuery, OperationSortField, PositionSortField }

export const OPERATION_SORTS: SortFields<OperationSortField> = {
  date: 'desc',
  type: 'asc',
  asset: 'asc',
  quantity: 'desc',
  amount: 'desc',
}

export const DEFAULT_OPERATION_SORT: SortChoice<OperationSortField> = { field: 'date', direction: 'desc' }

export async function listOperations(
  userId: string,
  query: OperationQuery = {},
): Promise<InvestmentOperation[]> {
  return await listOperationsDs(db(), userId, query)
}

/** The day the first operation happened, or null when nothing was ever declared. */
export async function firstOperationOn(userId: string): Promise<string | null> {
  return await earliestOperationDate(db(), userId)
}

/**
 * Brings the prices of what this user holds up to date, within the freshness
 * bound of each source, and never gets in the way of the read that called it:
 * a network failure, a rate limit or a source changing its shape all leave the
 * stored price in place. A stale price shown with its hour beats a page that
 * fails, so this function does not throw.
 *
 * There is no scheduler anywhere, on purpose. An hourly job would refresh at
 * night and be an hour stale exactly when a screen opens; refreshing on read
 * is fresh precisely when someone is looking.
 */
export async function refreshQuotes(
  userId: string,
  fetcher: Fetcher = fetchQuote,
  history: HistoryFetcher = fetchHistory,
): Promise<void> {
  const sql = db()
  const candidates = await instrumentsToRefresh(sql, userId)
  const now = Date.now()
  await Promise.all(
    candidates.map(async (candidate) => {
      // The spot quote first: it is what names the currency the venue quotes
      // in, which a foreign backfill needs before it can convert anything.
      const bound = candidate.marketOpen === false ? CLOSED_FRESHNESS_MS : FRESHNESS_MS[candidate.priceSource]
      const fresh = candidate.fetchedAt !== null && now - candidate.fetchedAt.getTime() < bound
      let quote: Quote | null = null
      if (!fresh) {
        try {
          quote = await fetcher(candidate.priceSource, candidate.priceSourceRef)
        } catch {
          // Deliberately silent: the caller is a read, and the stored price stands.
        }
      }
      // Within the freshness bound the quote is not refetched, so the venue's
      // currency is read back from the instrument, where it was learnt.
      const currency = (quote?.currency ?? candidate.instrumentCurrency).toUpperCase()

      // The backfill is checked outside the freshness bound: a fresh spot
      // price says nothing about whether the year behind it was ever fetched.
      // (Today's close cannot fake a backfill: hasPriceHistory looks a month
      // back.) A foreign history converts close by close, each day at its own
      // rate: the whole year at today's rate would draw the currency's curve.
      try {
        if (!(await hasPriceHistory(sql, candidate.instrumentId))) {
          const past = await history(candidate.priceSource, candidate.priceSourceRef)
          const stored =
            currency === 'EUR' ? past : toEurSeries(past, await eurRatesFor(sql, currency, history))
          await insertPriceHistory(sql, candidate.instrumentId, stored)
        }
      } catch {
        // No history is a missing curve, not a broken page.
      }

      if (!quote) return
      try {
        // What the source says it is, before anything can go wrong with the
        // price: this is how an instrument stored before the nature existed
        // gets typed, and how a source correcting itself is followed.
        if (quote.kind && quote.kind !== candidate.instrumentKind)
          await setInstrumentKind(sql, candidate.instrumentId, quote.kind)
        const day = quote.quotedAt.toISOString().slice(0, 10)
        // Stored prices are EUR counter-values by construction, whatever the
        // venue quotes in: every read below (positions, curve) stays a plain
        // multiplication. No rate for the day leaves the stored price standing.
        const price =
          currency === 'EUR'
            ? quote.price
            : String(Number(quote.price) * Number(await eurRateOn(sql, currency, day, history)))
        await upsertQuote(sql, candidate.instrumentId, { ...quote, price, currency: 'EUR' })
        await upsertClose(sql, candidate.instrumentId, day, price)
        // The venue's own currency, learnt from the quote: what lets the next
        // pass convert a backfill without refetching, and a screen say
        // "quoted in USD".
        if (currency !== candidate.instrumentCurrency)
          await setInstrumentCurrency(sql, candidate.instrumentId, currency)
      } catch {
        // Deliberately silent: the caller is a read, and the stored price stands.
      }
    }),
  )
}

/** A hand-typed price, for what no source quotes. Dated, because a price is. */
export async function setManualPrice(
  userId: string,
  assetId: string,
  price: number,
  pricedOn: string,
): Promise<Asset> {
  if (!(price >= 0)) throw new DomainError('bad_amount', 'A price cannot be negative')
  const asset = await getAsset(db(), userId, assetId)
  if (!asset) throw new DomainError('asset_not_found', `No asset ${assetId} for this user`)
  if (asset.instrumentId)
    throw new DomainError(
      'asset_is_quoted',
      `"${asset.name}" takes its price from its source: a hand-typed one would be a second answer`,
    )
  const updated = await updateAssetRow(db(), userId, assetId, {
    manualPrice: String(price),
    manualPricedOn: pricedOn,
  })
  // Revaluing an SCPI once a year is a history too, and two points already draw
  // a line: the curve should not start the day the app was opened.
  await upsertAssetPrice(db(), assetId, pricedOn, String(price))
  return updated!
}

/**
 * One nature of holding, with its own total: shares, funds, crypto, and what no
 * source quotes. The split between them is the allocation, which is the first
 * thing an account is read for and the decision that gets revised, so it is
 * totalled here rather than in each interface: a reader adding up lines by hand
 * (a person or an AI) gets it wrong.
 */
export interface PositionMass {
  nature: AssetNature
  positions: Position[]
  /** Every position with a price, cash excluded: a mass is what is held. */
  value: string
  costBasis: string
  /** Null while any position here lacks a price, which would understate it. */
  gain: string | null
  /** How many positions carry no price, so the value says how partial it is. */
  unpriced: number
}

export interface PortfolioAccount {
  account: Account
  /**
   * The cash sitting on the account: what it already held when it was taken
   * over, what movements brought in and out, and what operations moved inside
   * it. Not the account's worth, which is this plus what the holdings are
   * worth.
   */
  cash: string
  positions: Position[]
  /** The same positions, grouped by nature, biggest mass first. */
  masses: PositionMass[]
  /** What the holdings of this account cost, order fees included. */
  costBasis: string
  /** Cash plus every position that has a price. */
  value: string
  /** How many positions carry no price, so the value above says how partial it is. */
  unpriced: number
  /**
   * What was put in: the cash the account already held when it was taken over,
   * plus what movements brought, net of what they took out. The reference the
   * whole account is judged against: everything else that happened (dividends
   * in, fees out, purchases, sales) stayed inside the account.
   */
  netContributions: string
  /**
   * `value - netContributions`: what the account made, dividends received and
   * fees paid included, because both went through its cash. Null while any
   * position lacks a price, since a partial value would understate it.
   */
  totalReturn: string | null
}

/**
 * Positions grouped into the masses they belong to, each carrying its total.
 * Ordered by what they are worth, biggest first: that ranking *is* the reading
 * (which mass weighs the most), and it puts an unpriced mass last on its own.
 * Positions keep the order they came in, which is alphabetical.
 */
export function byNature(held: Position[]): PositionMass[] {
  const masses = new Map<AssetNature, Position[]>()
  for (const position of held) {
    const group = masses.get(position.nature)
    if (group) group.push(position)
    else masses.set(position.nature, [position])
  }
  return [...masses]
    .map(([nature, positions]) => {
      const priced = positions.filter((p) => p.value !== null)
      return {
        nature,
        positions,
        value: priced.reduce((sum, p) => sum + Number(p.value), 0).toFixed(2),
        costBasis: positions.reduce((sum, p) => sum + Number(p.costBasis), 0).toFixed(2),
        gain:
          priced.length === positions.length
            ? priced.reduce((sum, p) => sum + Number(p.gain), 0).toFixed(2)
            : null,
        unpriced: positions.length - priced.length,
      }
    })
    .sort((a, b) => Number(b.value) - Number(a.value))
}

/**
 * What is held, account by account, valued at the last known price. Prices are
 * refreshed by `refreshQuotes`, which the interfaces call before reading: this
 * function only reads, so it never depends on the network.
 */
export async function portfolio(
  userId: string,
  sort: SortChoice<PositionSortField> = DEFAULT_POSITION_SORT,
): Promise<PortfolioAccount[]> {
  const sql = db()
  const accounts = (await listAccountsWithBalance(sql, userId)).filter((a) => a.behavior === 'investment')
  const contributions = await netContributionsPerAccount(sql, userId)
  return await Promise.all(
    accounts.map(async (account) => {
      const held = await positionsDs(sql, userId, account.id, sort)
      const priced = held.filter((p) => p.value !== null)
      const value = Number(account.balance) + priced.reduce((sum, p) => sum + Number(p.value), 0)
      const net = Number(contributions.get(account.id) ?? 0)
      return {
        account,
        cash: account.balance,
        positions: held,
        masses: byNature(held),
        costBasis: held.reduce((sum, p) => sum + Number(p.costBasis), 0).toFixed(2),
        value: value.toFixed(2),
        unpriced: held.length - priced.length,
        netContributions: net.toFixed(2),
        totalReturn: held.length === priced.length ? (value - net).toFixed(2) : null,
      }
    }),
  )
}

/**
 * The daily worth of the whole portfolio, against the money put into it. The
 * period is the caller's: the same window the rest of the app is scoped to.
 */
export async function valuation(userId: string, from: string, to: string): Promise<ValuationPoint[]> {
  return await valuationSeries(db(), userId, from, to)
}

/** One day of the portfolio, and what it had made by then. */
export interface ValuationMilestone {
  day: string
  /** Cash plus holdings, at the last close known that day. */
  value: number
  /** What had been put in by then, opening cash and movements alike. */
  contributions: number
  /** Value minus contributions: dividends and fees included, they went through the cash. */
  performance: number
}

export interface ValuationHistory {
  from: string
  to: string
  /** What one milestone covers: a day on short windows, a month beyond. */
  step: 'day' | 'month'
  start: ValuationMilestone
  end: ValuationMilestone
  /** Best and worst the performance ever got, over the whole window. */
  high: ValuationMilestone
  low: ValuationMilestone
  milestones: ValuationMilestone[]
}

/** Milestones by day up to this many, by month beyond: a year is 365 lines. */
const DAILY_LIMIT = 45

function milestone(point: ValuationPoint): ValuationMilestone {
  const value = round(Number(point.cash) + Number(point.holdings))
  const contributions = round(Number(point.contributions))
  return { day: point.day, value, contributions, performance: round(value - contributions) }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * How the portfolio moved over a window, already totalled: where it started,
 * where it ended, its best and worst day, and milestones in between. The daily
 * series behind it is what the web draws; a reader that cannot check its own
 * arithmetic gets the conclusions instead, and never a year of raw points to
 * add up itself.
 *
 * Null when nothing has ever been bought: there is no history to speak of, as
 * opposed to a flat one.
 */
export async function valuationHistory(
  userId: string,
  from?: string,
  to?: string,
): Promise<ValuationHistory | null> {
  const sql = db()
  const first = await earliestOperationDate(sql, userId)
  if (!first) return null
  const end = to ?? today()
  // Never earlier than the first operation: the window asked for can reach
  // back further than anything happened, and empty days say nothing.
  const start = from && from > first ? from : first
  if (start > end) return null

  const series = await valuationSeries(sql, userId, start, end)
  const points = series.map(milestone)
  if (points.length === 0) return null

  const step = points.length <= DAILY_LIMIT ? 'day' : 'month'
  // A month's milestone is its last known day, so the closing figure is the
  // one being reported rather than an average of something.
  const milestones =
    step === 'day'
      ? points
      : points.filter(
          (p, i) => i === points.length - 1 || points[i + 1]!.day.slice(0, 7) !== p.day.slice(0, 7),
        )

  return {
    from: start,
    to: end,
    step,
    start: points[0]!,
    end: points[points.length - 1]!,
    // Measured on every day, not on the milestones: a peak between two month
    // ends is still a peak. A tie keeps the first day it was reached, which is
    // the one that says something: "at its high since the 6th".
    high: points.reduce((best, p) => (p.performance > best.performance ? p : best)),
    low: points.reduce((worst, p) => (p.performance < worst.performance ? p : worst)),
    milestones,
  }
}

/** The price history of one asset, for its own view. */
export async function assetHistory(
  userId: string,
  assetId: string,
): Promise<{ quotedOn: string; price: string }[]> {
  return await assetHistoryDs(db(), userId, assetId)
}

/** The last known price of each asset, followed ones included. */
export async function assetPrices(userId: string): Promise<Map<string, string | null>> {
  return await assetPricesDs(db(), userId)
}

/**
 * What a holdings list offers to be ordered on. It opens on the value,
 * biggest first: the alphabet answers no question a portfolio is read for,
 * where "what weighs the most here" is the first one.
 */
export const POSITION_SORTS: SortFields<PositionSortField> = {
  name: 'asc',
  quantity: 'desc',
  price: 'desc',
  value: 'desc',
  gain: 'desc',
}

export const DEFAULT_POSITION_SORT: SortChoice<PositionSortField> = { field: 'value', direction: 'desc' }

export async function positions(
  userId: string,
  accountId?: string,
  sort: SortChoice<PositionSortField> = DEFAULT_POSITION_SORT,
): Promise<Position[]> {
  return await positionsDs(db(), userId, accountId, sort)
}

/**
 * What the holdings are worth, on top of the account balances. Everywhere else
 * wealth is the sum of balances, and an investment account's balance is its
 * cash: without this the total ignores the holdings entirely, which is exactly
 * what made the dashboard wrong as soon as a placement moved.
 *
 * `unpriced` is what the figure cannot include, so a screen can say the total
 * is partial rather than passing it off as whole.
 */
export async function holdingsValue(userId: string): Promise<{ value: number; unpriced: number }> {
  const held = await positionsDs(db(), userId)
  return {
    value: held.reduce((sum, p) => sum + Number(p.value ?? 0), 0),
    unpriced: held.filter((p) => p.value === null).length,
  }
}

export interface CorrectOperationInput {
  accountId?: string
  quantity?: number
  amount?: number
  /** As on declaration: the total follows from the quantity it applies to. */
  unitPrice?: number
  operatedOn?: string
  note?: string | null
}

/**
 * Corrects a declared operation. A wrong amount is not a detail here: it feeds
 * the weighted average cost, so it would misstate the holding for as long as it
 * is held, which is why this exists at all.
 *
 * What cannot change is what would make it another operation entirely: its type
 * (a purchase is not a sale) and its asset. Those are corrected by deleting this
 * one and declaring the right one, which is the honest way to say it never
 * happened.
 */
export async function correctOperation(
  userId: string,
  id: string,
  input: CorrectOperationInput,
): Promise<InvestmentOperation> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const before = await requireOperation(tx, userId, id)
    const trade = before.type === 'buy' || before.type === 'sell'
    if (input.quantity !== undefined && !trade)
      throw new DomainError('unexpected_quantity', 'Only a buy or a sell moves a quantity')
    if (input.quantity !== undefined && !(input.quantity > 0))
      throw new DomainError('needs_quantity', 'A quantity is always positive')
    if (input.amount !== undefined && !(input.amount > 0))
      throw new DomainError('bad_amount', 'An amount is always positive')
    if (input.amount !== undefined && input.unitPrice !== undefined)
      throw new DomainError(
        'amount_or_unit_price',
        'Give either the total amount or the unit price, not both: they would contradict each other',
      )
    // A unit price applies to a quantity, the corrected one when there is one.
    const unitTotal =
      input.unitPrice === undefined
        ? undefined
        : Math.round(input.unitPrice * (input.quantity ?? Number(before.quantity)) * 100) / 100

    if (input.accountId && input.accountId !== before.accountId) {
      const account = await getAccount(tx, userId, input.accountId)
      if (!account) throw new DomainError('account_not_found', `No account ${input.accountId} for this user`)
      if (account.behavior !== 'investment')
        throw new DomainError(
          'not_an_investment_account',
          `"${account.name}" is not an investment account: only those carry operations`,
        )
    }

    const patch: Record<string, unknown> = {}
    if (input.accountId) patch.accountId = input.accountId
    if (input.quantity !== undefined) patch.quantity = String(input.quantity)
    if (input.amount !== undefined) patch.amount = String(input.amount)
    if (unitTotal !== undefined) patch.amount = String(unitTotal)
    if (input.operatedOn) patch.operatedOn = input.operatedOn
    if (input.note !== undefined) patch.note = input.note
    const after = Object.keys(patch).length > 0 ? await updateOperationRow(tx, userId, id, patch) : before
    await assertHoldingStaysPositive(tx, userId, before, after!)
    return after!
  })
}

/** Removes an operation that never happened. */
export async function deleteOperation(userId: string, id: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    const before = await requireOperation(tx, userId, id)
    await deleteOperationRow(tx, userId, id)
    await assertHoldingStaysPositive(tx, userId, before, before)
  })
}

async function requireOperation(tx: Executor, userId: string, id: string): Promise<InvestmentOperation> {
  const operation = await getOperation(tx, userId, id)
  if (!operation) throw new DomainError('operation_not_found', `No operation ${id} for this user`)
  return operation
}

/**
 * Refuses a change that would have a holding sell what it never held, at any
 * point of its history: the transaction is rolled back rather than leaving an
 * average cost computed on an impossible sequence. Both the operation as it was
 * and as it becomes are checked, since a correction can move it from one holding
 * to another and break the one it left behind.
 */
async function assertHoldingStaysPositive(
  tx: Executor,
  userId: string,
  before: InvestmentOperation,
  after: InvestmentOperation,
): Promise<void> {
  const touched = new Map<string, { accountId: string; assetId: string }>()
  for (const operation of [before, after]) {
    if (!operation.assetId) continue
    touched.set(`${operation.accountId}:${operation.assetId}`, {
      accountId: operation.accountId,
      assetId: operation.assetId,
    })
  }
  for (const { accountId, assetId } of touched.values()) {
    const lowest = Number(await lowestRunningQuantity(tx, userId, accountId, assetId))
    if (lowest < 0)
      throw new DomainError(
        'oversold',
        'That would leave a sale selling more than was held at the time: correct the sale first',
      )
  }
}
