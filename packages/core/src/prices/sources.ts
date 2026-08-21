import type { PriceSource } from '../domain/types.ts'

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

export type Fetcher = (source: PriceSource, reference: string) => Promise<Quote>

export const fetchQuote: Fetcher = (source, reference) =>
  source === 'yahoo' ? fetchYahoo(reference) : fetchCoinGecko(reference)
