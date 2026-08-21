import type { InstrumentKind, PriceSource } from '../domain/types.ts'
import { fetchYahoo } from './sources.ts'

/**
 * A candidate instrument, as its source describes it. Everything a person needs
 * to tell two listings of the same fund apart is here: the same ETF is listed
 * in Paris, Milan and Frankfurt, under three symbols, and only the venue and
 * the price say which one they hold.
 */
export interface InstrumentHit {
  source: PriceSource
  /** What identifies it at that source: a Yahoo symbol, a CoinGecko id. */
  reference: string
  name: string
  kind: InstrumentKind
  /** As the source labels it: "ETF", "Equity", "Crypto". */
  typeLabel: string
  venue: string | null
  /** Present once checked: what one unit costs, and in which currency. */
  price: string | null
  currency: string | null
  /** False when priced in another currency, which this app cannot hold yet. */
  available: boolean
}

const TIMEOUT_MS = 5000

/** How many hits get their currency checked: enough to fill a result list. */
const CHECKED = 8

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json()
}

interface YahooQuote {
  symbol?: string
  shortname?: string
  longname?: string
  exchDisp?: string
  quoteType?: string
  typeDisp?: string
}

/** Securities and funds. Indices and currencies are not things one holds here. */
const HELD_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND'])

export function parseYahooSearch(payload: unknown): InstrumentHit[] {
  const quotes = (payload as { quotes?: YahooQuote[] })?.quotes ?? []
  return quotes
    .filter((q) => q.symbol && HELD_TYPES.has(q.quoteType ?? ''))
    .map((q) => ({
      source: 'yahoo' as const,
      reference: q.symbol!,
      // longname is the readable one but is often absent, and shortname is
      // sometimes an abbreviation ("Am.ETF-MSCI W.SRI Cl.Par.Alig.B"), so the
      // symbol stays visible next to the name rather than replacing it.
      name: q.longname ?? q.shortname ?? q.symbol!,
      kind: 'security' as const,
      typeLabel: q.typeDisp ?? 'Titre',
      venue: q.exchDisp ?? null,
      price: null,
      currency: null,
      available: true,
    }))
}

interface GeckoCoin {
  id?: string
  symbol?: string
  name?: string
  market_cap_rank?: number | null
}

export function parseGeckoSearch(payload: unknown): InstrumentHit[] {
  const coins = (payload as { coins?: GeckoCoin[] })?.coins ?? []
  return (
    coins
      .filter((c) => c.id && c.name)
      // Market cap orders "Bitcoin" before "Bitcoin SV" without hardcoding
      // anything: an unranked coin is a long tail one, and goes last.
      .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))
      .map((c) => ({
        source: 'coingecko' as const,
        reference: c.id!,
        name: c.symbol ? `${c.name} (${c.symbol.toUpperCase()})` : c.name!,
        kind: 'crypto' as const,
        typeLabel: 'Crypto',
        venue: null,
        // CoinGecko is asked in euros, so a coin is priceable by construction.
        price: null,
        currency: 'EUR',
        available: true,
      }))
  )
}

/**
 * Searches both sources at once, by anything a person actually knows: a name
 * ("msci world"), a provider ("amundi", "ishares"), a symbol ("CW8.PA"), an
 * ISIN ("FR0010315770") or a coin name. Yahoo resolves all of those, CoinGecko
 * covers the crypto side, and neither needs a key.
 *
 * The first hits then get their real currency, by asking for their price. That
 * replaces guessing from the venue label: this application values euros only
 * until multi-currency lands (issue #10), so what is priced in another currency
 * is shown as unavailable rather than filtered out in silence, and what is
 * usable comes first. The price it brings back is not a detail either: it is
 * what tells the holder they picked the right listing.
 */
export async function searchInstruments(query: string): Promise<InstrumentHit[]> {
  const term = query.trim()
  if (term.length < 2) return []
  const encoded = encodeURIComponent(term)
  const [securities, coins] = await Promise.all([
    getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=12&newsCount=0`)
      .then(parseYahooSearch)
      .catch(() => [] as InstrumentHit[]),
    getJson(`https://api.coingecko.com/api/v3/search?query=${encoded}`)
      .then(parseGeckoSearch)
      .catch(() => [] as InstrumentHit[]),
  ])

  const [pricedSecurities, pricedCoins] = await Promise.all([
    Promise.all(
      securities.slice(0, CHECKED).map(async (hit) => {
        try {
          const quote = await fetchYahoo(hit.reference)
          return {
            ...hit,
            price: quote.price,
            currency: quote.currency,
            available: quote.currency === 'EUR',
          }
        } catch {
          // A hit whose price cannot be read is still a real instrument: it is
          // shown without one rather than dropped.
          return hit
        }
      }),
    ),
    priceCoins(coins.slice(0, CHECKED)),
  ])

  // Securities and coins are kept apart rather than merged into one ranking:
  // searching "apple" would otherwise put tokenized Apple derivatives above the
  // share itself, since both are priced in euros and neither source can rank
  // against the other. Usable first inside each nature, and nothing else
  // reordered: each source already ranked its own results by relevance.
  const usable = (hits: InstrumentHit[]) => [
    ...hits.filter((h) => h.available),
    ...hits.filter((h) => !h.available),
  ]
  return [...usable(pricedSecurities), ...usable(pricedCoins)]
}

/**
 * One call for every coin: CoinGecko takes a comma-separated list of ids, and a
 * price is what tells "Bitcoin" from "Dog (Bitcoin)" at a glance.
 */
async function priceCoins(coins: InstrumentHit[]): Promise<InstrumentHit[]> {
  if (coins.length === 0) return []
  try {
    const ids = coins.map((c) => encodeURIComponent(c.reference)).join(',')
    const payload = (await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`,
    )) as Record<string, { eur?: number }>
    return coins.map((coin) => {
      const price = payload?.[coin.reference]?.eur
      return typeof price === 'number' ? { ...coin, price: String(price) } : coin
    })
  } catch {
    return coins
  }
}
