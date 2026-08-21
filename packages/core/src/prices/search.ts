import type { InstrumentKind, PriceSource } from '../domain/types.ts'
import { fetchYahoo } from './sources.ts'

/**
 * A candidate to hold, as its source describes it. One entry is one **fund or
 * share**, not one line of quotation: the same ETF is listed in Amsterdam,
 * Milan and Frankfurt, and those quote 709,07 / 709,10 / 709,16 EUR for the same
 * thing. Measured on 2026-08-21: 0,01 % apart. Making someone pick a venue
 * therefore adds every bit of the noise and none of the accuracy, so a venue in
 * euros is picked here and merely stated.
 */
export interface InstrumentHit {
  source: PriceSource
  /** The listing retained: what the price will be read from. */
  reference: string
  /** The fund's own name, as its source spells it. */
  name: string
  /** Who runs it: iShares, Amundi, Vanguard. What tells two S&P 500 apart. */
  issuer: string | null
  /** Accumulating or distributing, when the name says so. The other divider. */
  payout: 'accumulating' | 'distributing' | null
  kind: InstrumentKind
  typeLabel: string
  venue: string | null
  /** Set when the search term was itself an ISIN: the one unambiguous id. */
  isin: string | null
  price: string | null
  currency: string | null
  /** False when nothing quotes it in euros, which this app cannot hold yet. */
  available: boolean
  /** Other venues of the same fund, so the grouping can be seen, not guessed. */
  otherVenues: number
}

const TIMEOUT_MS = 5000

/** Quotation lines whose price gets checked. Enough to cover a few funds. */
const CHECKED = 18

/** Two letters, nine alphanumerics, one check digit. */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json()
}

/** Only funds have a manager and a payout policy; a share has neither. */
const FUND_TYPES = new Set(['ETF', 'MUTUALFUND'])

interface YahooQuote {
  symbol?: string
  quoteType?: string
  shortname?: string
  longname?: string
  exchDisp?: string
  typeDisp?: string
}

/** Securities and funds. Indices and currencies are not things one holds here. */
const HELD_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND'])

/**
 * Who runs the fund, which is the first thing that tells two S&P 500 trackers
 * apart. Fund names lead with it ("iShares Core S&P 500...", "Vanguard S&P
 * 500...", "Amundi Index Solutions - Amundi MSCI World..."), so the first word
 * carries it. A miss shows nothing rather than something wrong.
 */
export function issuerOf(name: string): string | null {
  const first = name.trim().split(/[\s-]+/)[0]
  return first && first.length > 2 && /^[A-Za-z]/.test(first) ? first : null
}

/**
 * Accumulating or distributing: the second divider, and the one that decides
 * whether dividends show up as income. Only the spelled-out forms are read; a
 * lone "C" or "D" in a name is too often something else, and "Inc" is
 * Incorporated far more often than Income.
 */
export function payoutOf(name: string): 'accumulating' | 'distributing' | null {
  const n = name.toLowerCase()
  if (/\b(acc|accumulating|accumulation|capitalisant)\b/.test(n)) return 'accumulating'
  if (/\b(dist|distributing|distribution|income)\b/.test(n)) return 'distributing'
  return null
}

export function parseYahooSearch(payload: unknown): YahooQuote[] {
  const quotes = (payload as { quotes?: YahooQuote[] })?.quotes ?? []
  return quotes.filter((q) => q.symbol && HELD_TYPES.has(q.quoteType ?? ''))
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
        name: c.name!,
        issuer: null,
        payout: null,
        kind: 'crypto' as const,
        typeLabel: c.symbol ? c.symbol.toUpperCase() : 'Crypto',
        venue: null,
        isin: null,
        price: null,
        // CoinGecko is asked in euros, so a coin is priceable by construction.
        currency: 'EUR',
        available: true,
        otherVenues: 0,
      }))
  )
}

/**
 * Searches both sources at once, by anything a person actually knows: a name
 * ("s&p 500"), a provider ("amundi", "ishares"), a ticker ("CW8.PA"), an ISIN,
 * or a coin. Yahoo resolves all of those and CoinGecko covers crypto; neither
 * needs a key.
 *
 * The listings that come back are then **grouped into funds** by their own
 * canonical name, and each fund keeps one listing quoted in euros. That is what
 * turns "s&p 500 ucits" from seven near-identical lines into the three funds it
 * actually is, and it is why nobody has to know that CSPX.AS, CSSPX.MI and
 * SXR8.DE are one and the same thing.
 *
 * An ISIN typed in is carried onto the result: it is the only unambiguous
 * identifier of a fund, it is what the broker's app shows, and keeping it lets
 * the holding be checked again later.
 */
export async function searchInstruments(query: string): Promise<InstrumentHit[]> {
  const term = query.trim()
  if (term.length < 2) return []
  const isin = ISIN.test(term.toUpperCase()) ? term.toUpperCase() : null
  const encoded = encodeURIComponent(term)

  const [listings, coins] = await Promise.all([
    getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=25&newsCount=0`)
      .then(parseYahooSearch)
      .catch(() => [] as YahooQuote[]),
    getJson(`https://api.coingecko.com/api/v3/search?query=${encoded}`)
      .then(parseGeckoSearch)
      .catch(() => [] as InstrumentHit[]),
  ])

  const funds = await groupIntoFunds(listings.slice(0, CHECKED), isin)
  const pricedCoins = (await priceCoins(coins.slice(0, 6))).sort(
    (a, b) => Number(b.price !== null) - Number(a.price !== null),
  )

  // Securities and coins stay apart rather than merged into one ranking:
  // searching "apple" would otherwise put tokenized Apple derivatives above the
  // share itself, since both are priced in euros and neither source can rank
  // against the other. Usable first inside each nature, and nothing else
  // reordered: each source already ranked its own results by relevance.
  const usable = (hits: InstrumentHit[]) => [
    ...hits.filter((h) => h.available),
    ...hits.filter((h) => !h.available),
  ]
  return [...usable(funds), ...usable(pricedCoins)]
}

/**
 * One entry per fund, holding the listing to read prices from. Every listing is
 * priced in parallel, then each fund keeps its cheapest-to-read line: one quoted
 * in euros if it has any, since that is the only kind this application can
 * value, and its first line otherwise so the fund can still be shown as out of
 * reach instead of vanishing.
 */
async function groupIntoFunds(listings: YahooQuote[], isin: string | null): Promise<InstrumentHit[]> {
  const priced = await Promise.all(
    listings.map(async (listing) => {
      try {
        const quote = await fetchYahoo(listing.symbol!)
        return { listing, price: quote.price as string | null, currency: quote.currency as string | null }
      } catch {
        // A listing whose price cannot be read is still real: it stays a
        // candidate, without a price.
        return { listing, price: null, currency: null }
      }
    }),
  )

  const byFund = new Map<string, typeof priced>()
  for (const entry of priced) {
    // The canonical name is the grouping key: Yahoo spells it identically
    // across venues, which is what makes this work without a second source.
    const key = (entry.listing.longname ?? entry.listing.shortname ?? entry.listing.symbol!).trim()
    const group = byFund.get(key)
    if (group) group.push(entry)
    else byFund.set(key, [entry])
  }

  return [...byFund.entries()].map(([name, group]) => {
    const euro = group.find((e) => e.currency === 'EUR')
    const chosen = euro ?? group[0]!
    const isFund = FUND_TYPES.has(chosen.listing.quoteType ?? '')
    return {
      source: 'yahoo' as const,
      reference: chosen.listing.symbol!,
      name,
      issuer: isFund ? issuerOf(name) : null,
      payout: isFund ? payoutOf(name) : null,
      kind: 'security' as const,
      typeLabel: chosen.listing.typeDisp ?? 'Titre',
      venue: chosen.listing.exchDisp ?? null,
      isin,
      price: chosen.price,
      currency: chosen.currency,
      available: euro !== undefined,
      otherVenues: group.length - 1,
    }
  })
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
