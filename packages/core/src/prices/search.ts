import type { InstrumentKind, PriceSource } from '../domain/types.ts'
import { fetchYahoo, kindOfYahooType } from './sources.ts'

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
  /**
   * False when no venue answered a price at all: a foreign one converts at
   * read (issue #47), so only the unpriceable stays out of reach.
   */
  available: boolean
  /** Other venues of the same fund, so the grouping can be seen, not guessed. */
  otherVenues: number
}

const TIMEOUT_MS = 5000

/**
 * Quotation lines whose price gets checked. Two searches feed this now, so it
 * covers more funds than it used to: enough for a few, and the cap is what
 * keeps a search under a second.
 */
const CHECKED = 24

/**
 * How many funds that look unavailable get a second look. Each one costs a
 * search plus a price per venue it turns up, so it is worth a few and not the
 * whole list.
 */
const RESCUED = 4

/** Two letters, nine alphanumerics, one check digit. */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

async function searchYahoo(encodedQuery: string): Promise<YahooQuote[]> {
  return await getJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodedQuery}&quotesCount=25&newsCount=0`,
  )
    .then(parseYahooSearch)
    .catch(() => [] as YahooQuote[])
}

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

/** A listing with whatever its price call returned. */
interface PricedListing {
  listing: YahooQuote
  price: string | null
  currency: string | null
}

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

  const [plain, ucits, coins] = await Promise.all([
    searchYahoo(encoded),
    // The same search again, narrowed to European funds. Measured: "s&p 500"
    // returns no fund at all, "s&p 500 ucits" returns seven; "nasdaq 100"
    // returns three, all American, against seven. Yahoo simply does not surface
    // European lines without that word, and without them the only selectable
    // results left were tokenized crypto imitations of the very ETF being
    // looked for. UCITS is not a preference, it is the regulatory frame of the
    // funds a European saver actually buys.
    isin || /ucits/i.test(term) ? Promise.resolve([] as YahooQuote[]) : searchYahoo(`${encoded}%20ucits`),
    getJson(`https://api.coingecko.com/api/v3/search?query=${encoded}`)
      .then(parseGeckoSearch)
      .catch(() => [] as InstrumentHit[]),
  ])
  // Merged on the symbol: the two searches overlap, and the plain one ranked
  // its results by relevance, so it goes first.
  const seen = new Set<string>()
  const listings = [...plain, ...ucits].filter((q) => {
    if (seen.has(q.symbol!)) return false
    seen.add(q.symbol!)
    return true
  })

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
 * in euros if it has any (a euro line needs no conversion, so it stays the
 * default), and its first line otherwise, which converts at read.
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

  // A fund with no euro line among the results often has one: Yahoo simply did
  // not return the venue that carries it. Asked for an ISIN it answers a single
  // listing, and it is regularly the London one in pounds while the same fund
  // trades in euros on XETRA and Milan. A euro line needs no conversion, so it
  // is still worth looking for before settling on a foreign one.
  const entries = [...byFund.entries()]
  const withoutEuro = entries.filter(([, group]) => !group.some((e) => e.currency === 'EUR'))
  // In parallel: four of these in a row was the whole second and a half a wide
  // search took, for calls that have nothing to do with each other.
  const rescued = new Map<string, { euro?: PricedListing; venues: number }>()
  await Promise.all(
    withoutEuro.slice(0, RESCUED).map(async ([name]) => {
      rescued.set(name, await findEuroListing(name))
    }),
  )

  return entries.map(([name, group]) => {
    const found = rescued.get(name)
    const euro = group.find((e) => e.currency === 'EUR') ?? found?.euro
    const chosen = euro ?? group[0]!
    // Every venue known of this fund, whether it came from the first answer or
    // from looking further: that count is what tells a single result apart from
    // a fund whose listings were merged into one.
    const venues = Math.max(group.length, found?.venues ?? 0)
    const isFund = FUND_TYPES.has(chosen.listing.quoteType ?? '')
    return {
      source: 'yahoo' as const,
      reference: chosen.listing.symbol!,
      name,
      issuer: isFund ? issuerOf(name) : null,
      payout: isFund ? payoutOf(name) : null,
      // Typed from the search when it says, so a holding lands in its mass the
      // moment it is declared rather than at the next price read. Untyped stays
      // "security": quoted, nature not known yet.
      kind: kindOfYahooType(chosen.listing.quoteType) ?? ('security' as const),
      typeLabel: chosen.listing.typeDisp ?? 'Titre',
      venue: chosen.listing.exchDisp ?? null,
      isin,
      price: chosen.price,
      currency: chosen.currency,
      // Priceable at all: a foreign quote converts, an unpriced line cannot.
      available: chosen.price !== null,
      otherVenues: Math.max(venues - 1, 0),
    }
  })
}

/**
 * Every venue carrying one named fund, priced. What varies between them is the
 * whole point: the ticker, the place, the currency and the price. What does not
 * vary (the name, the issuer, the payout policy, the ISIN) is the fund itself,
 * which is why they are one entry until someone asks to see them.
 */
export async function listVenues(name: string): Promise<InstrumentVenue[]> {
  const priced = await priceSiblings(name)
  return priced.map((entry) => ({
    reference: entry.listing.symbol!,
    venue: entry.listing.exchDisp ?? null,
    price: entry.price,
    currency: entry.currency,
    // A foreign quote converts at read: only a line whose price could not be
    // read stays unpickable.
    available: entry.price !== null,
  }))
}

export interface InstrumentVenue {
  reference: string
  venue: string | null
  price: string | null
  currency: string | null
  available: boolean
}

/**
 * Looks for a euro listing of one named fund, by asking the source for every
 * venue that carries that exact name and pricing them until one answers in
 * euros. Measured on Amundi Core MSCI Japan: the ISIN gives London in pounds,
 * while XETRA and Milan quote it in euros and Amsterdam in yen.
 */
async function findEuroListing(name: string): Promise<{ euro?: PricedListing; venues: number }> {
  const priced = await priceSiblings(name)
  return { euro: priced.find((e) => e.currency === 'EUR'), venues: priced.length }
}

/** Every listing carrying that exact fund name, with its price. */
async function priceSiblings(name: string): Promise<PricedListing[]> {
  try {
    const payload = await getJson(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=15&newsCount=0`,
    )
    // The exact name is the grouping key, so a near match is another fund.
    const siblings = parseYahooSearch(payload).filter(
      (q) => (q.longname ?? q.shortname ?? '').trim() === name,
    )
    return await Promise.all(
      siblings.slice(0, 8).map(async (listing) => {
        try {
          const quote = await fetchYahoo(listing.symbol!)
          return { listing, price: quote.price as string | null, currency: quote.currency as string | null }
        } catch {
          return { listing, price: null, currency: null }
        }
      }),
    )
  } catch {
    return []
  }
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
