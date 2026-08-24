import type { InstrumentKind, PriceSource } from '../domain/types.ts'

/**
 * A price as a source gave it, with the moment the market made it. Never the
 * moment we asked: that is the caller's business, and confusing the two would
 * show a fetch time as if it were a market time.
 */
export interface Quote {
  price: string
  currency: string
  quotedAt: Date
  /** When the venue is open, so a closed one is not polled for nothing. */
  marketOpen: boolean
  /** What the source says it is, when it says: absent leaves the stored kind. */
  kind?: InstrumentKind
}

/**
 * Yahoo's own type, in our words. It comes back from the search (`quoteType`)
 * and from the price call (`instrumentType`), spelled identically, which is
 * what lets a holding be typed at declaration and re-typed at every read.
 *
 * An ETF and a fund quoted by an insurer are one mass: what gets revised is the
 * share of funds against the share of shares, not the vehicle holding the fund.
 * Anything else is left untyped rather than guessed.
 */
export function kindOfYahooType(type: string | undefined): InstrumentKind | undefined {
  if (type === 'EQUITY') return 'equity'
  if (type === 'ETF' || type === 'MUTUALFUND') return 'fund'
  if (type === 'CRYPTOCURRENCY') return 'crypto'
  if (type === 'CURRENCY') return 'currency'
  return undefined
}

/** How stale a price may get before it is worth asking again. */
export const FRESHNESS_MS: Record<PriceSource, number> = {
  // The best free freshness on Euronext is a 15 minute delay, imposed by the
  // market data licence: asking more often cannot return anything newer.
  yahoo: 15 * 60 * 1000,
  // CoinGecko's own CDN caches for 30 to 60 seconds, so this is its floor too.
  coingecko: 60 * 1000,
}

/**
 * A closed venue cannot move, so its last price stays right until it reopens.
 * Euronext trades a quarter of the week: without this, every evening and every
 * weekend read would re-fetch a frozen close every 15 minutes.
 */
export const CLOSED_FRESHNESS_MS = 60 * 60 * 1000

/**
 * These endpoints are read-only public data, but they are not contracts: Yahoo's
 * is unofficial and CoinGecko rate-limits by IP. A price is therefore always
 * allowed to be missing, and every caller must survive it: a stale price shown
 * with its hour beats a page that fails.
 */
const TIMEOUT_MS = 4000

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json()
}

/**
 * Yahoo Finance, through the chart endpoint. It is the one that needs no
 * authentication: the quote endpoint, which would take a batch of symbols,
 * answers 401 without a cookie and crumb pair.
 */
export function parseYahoo(payload: unknown): Quote {
  const meta = (payload as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]
    ?.meta
  const price = meta?.regularMarketPrice
  const time = meta?.regularMarketTime
  const currency = meta?.currency
  if (typeof price !== 'number' || typeof time !== 'number' || typeof currency !== 'string')
    throw new Error('Yahoo answered without a usable quote')
  // The session window comes with the quote, per instrument, so no exchange
  // hours are hardcoded anywhere: the data says when its own market is open.
  const session = meta?.currentTradingPeriod as { start?: number; end?: number } | undefined
  const now = Date.now() / 1000
  const marketOpen =
    typeof session?.start === 'number' && typeof session?.end === 'number'
      ? now >= session.start && now <= session.end
      : true
  return {
    price: String(price),
    currency: currency.toUpperCase(),
    quotedAt: new Date(time * 1000),
    marketOpen,
    // The price call states what it is pricing, so the nature travels with the
    // price and nobody has to classify a holding by hand.
    kind: kindOfYahooType(typeof meta?.instrumentType === 'string' ? meta.instrumentType : undefined),
  }
}

export async function fetchYahoo(reference: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(reference)}?interval=1d&range=1d`
  return parseYahoo(await getJson(url))
}

/** CoinGecko, which answers in euros directly and needs no key. */
export function parseCoinGecko(payload: unknown, reference: string): Quote {
  const row = (payload as Record<string, { eur?: number; last_updated_at?: number }>)?.[reference]
  if (typeof row?.eur !== 'number') throw new Error('CoinGecko answered without a usable quote')
  return {
    price: String(row.eur),
    currency: 'EUR',
    // Crypto trades around the clock, so there is no closed window to skip.
    quotedAt: new Date((row.last_updated_at ?? Date.now() / 1000) * 1000),
    marketOpen: true,
  }
}

export async function fetchCoinGecko(reference: string): Promise<Quote> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(reference)}&vs_currencies=eur&include_last_updated_at=true`
  return parseCoinGecko(await getJson(url), reference)
}

/** One day's close, as a source hands it over. */
export interface HistoricalPrice {
  quotedOn: string
  price: string
}

/**
 * A year of daily closes, which is what a curve needs and what both sources
 * give in a single call (256 points in 27 KB, measured 2026-08-21). Anything
 * older is not worth the call: the app itself is days old, and a holding
 * declared today has no history of its own before it.
 */
export async function fetchYahooHistory(reference: string): Promise<HistoricalPrice[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(reference)}?interval=1d&range=1y`
  return parseYahooHistory(await getJson(url))
}

export function parseYahooHistory(payload: unknown): HistoricalPrice[] {
  const result = (
    payload as {
      chart?: {
        result?: {
          timestamp?: number[]
          indicators?: { adjclose?: { adjclose?: (number | null)[] }[] }
        }[]
      }
    }
  )?.chart?.result?.[0]
  const stamps = result?.timestamp ?? []
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? []
  const history: HistoricalPrice[] = []
  for (const [i, stamp] of stamps.entries()) {
    const close = closes[i]
    // The running day comes back with a null adjusted close: a day still being
    // traded has no close yet, and writing zero would draw a cliff.
    if (typeof close !== 'number' || !Number.isFinite(close)) continue
    history.push({ quotedOn: new Date(stamp * 1000).toISOString().slice(0, 10), price: String(close) })
  }
  return history
}

export async function fetchCoinGeckoHistory(reference: string): Promise<HistoricalPrice[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(reference)}/market_chart?vs_currency=eur&days=365&interval=daily`
  return parseCoinGeckoHistory(await getJson(url))
}

export function parseCoinGeckoHistory(payload: unknown): HistoricalPrice[] {
  const prices = (payload as { prices?: [number, number][] })?.prices ?? []
  const byDay = new Map<string, string>()
  for (const [ms, price] of prices) {
    if (typeof price !== 'number' || !Number.isFinite(price)) continue
    // Crypto trades around the clock and the last point is intraday: one entry
    // per day, the latest of that day winning.
    byDay.set(new Date(ms).toISOString().slice(0, 10), String(price))
  }
  return [...byDay.entries()].map(([quotedOn, price]) => ({ quotedOn, price }))
}

export type Fetcher = (source: PriceSource, reference: string) => Promise<Quote>

export type HistoryFetcher = (source: PriceSource, reference: string) => Promise<HistoricalPrice[]>

export const fetchHistory: HistoryFetcher = (source, reference) =>
  source === 'yahoo' ? fetchYahooHistory(reference) : fetchCoinGeckoHistory(reference)

export const fetchQuote: Fetcher = (source, reference) =>
  source === 'yahoo' ? fetchYahoo(reference) : fetchCoinGecko(reference)
