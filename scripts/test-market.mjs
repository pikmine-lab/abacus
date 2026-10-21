// A local market for the tests, in place of Yahoo Finance and CoinGecko.
//
// The app reads both sources at the addresses ABACUS_MARKET_YAHOO_URL and
// ABACUS_MARKET_COINGECKO_URL (packages/core/src/prices/endpoints.ts). Started
// once per test run by `--test-global-setup`, this server answers on the paths
// the app calls, in the shapes the real sources use, with fixed data: one
// share quoted in dollars, one fund in euros on two venues, one coin, and the USD/EUR and
// GBP/EUR rates. Prices are flat over the year, so a result never depends on
// the day the tests run. What the real source does not know gets its empty
// answer, so the app's "nothing found" path is the one exercised.
//
// It lives outside every package: packages/core tests need it, and so does the
// use case suite, which depends on packages/core.

import { createServer } from 'node:http'

const SECURITIES = {
  ACME: {
    price: 180,
    currency: 'USD',
    quoteType: 'EQUITY',
    shortname: 'Acme Corp',
    longname: 'Acme Corporation',
    exchDisp: 'NASDAQ',
    typeDisp: 'Equity',
  },
  'WRLD.PA': {
    price: 520,
    currency: 'EUR',
    quoteType: 'ETF',
    shortname: 'AMUNDI MSCI WORLD',
    longname: 'Amundi MSCI World UCITS ETF Acc',
    exchDisp: 'Paris',
    typeDisp: 'ETF',
  },
  // The same fund on another venue, a few cents apart: what a search groups
  // into one fund, its venues listed on demand.
  'WRLD.DE': {
    price: 520.5,
    currency: 'EUR',
    quoteType: 'ETF',
    shortname: 'AMUNDI MSCI WORLD',
    longname: 'Amundi MSCI World UCITS ETF Acc',
    exchDisp: 'XETRA',
    typeDisp: 'ETF',
  },
  'USDEUR=X': { price: 0.86, currency: 'EUR', quoteType: 'CURRENCY', shortname: 'USD/EUR' },
  'GBPEUR=X': { price: 1.15, currency: 'EUR', quoteType: 'CURRENCY', shortname: 'GBP/EUR' },
}

const COINS = {
  bitcoin: { price: 60000, name: 'Bitcoin', symbol: 'btc', rank: 1 },
}

const DAY_MS = 86_400_000

/** A year of daily points up to today, at noon UTC so each lands on its own day. */
function year() {
  const noon = Math.floor(Date.now() / DAY_MS) * DAY_MS + DAY_MS / 2
  return Array.from({ length: 365 }, (_, i) => noon - (364 - i) * DAY_MS)
}

/** Every word of the query found in the symbol or the names, as a loose search does. */
function matches(query, ...fields) {
  const text = fields.join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

function yahooChart(symbol) {
  const security = SECURITIES[symbol]
  if (!security)
    return [404, { chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }]
  const stamps = year().map((ms) => Math.floor(ms / 1000))
  const closes = stamps.map(() => security.price)
  return [
    200,
    {
      chart: {
        result: [
          {
            meta: {
              currency: security.currency,
              symbol,
              instrumentType: security.quoteType,
              regularMarketPrice: security.price,
              regularMarketTime: Math.floor(Date.now() / 1000),
            },
            timestamp: stamps,
            indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: closes }] },
          },
        ],
        error: null,
      },
    },
  ]
}

function yahooSearch(query) {
  const quotes = Object.entries(SECURITIES)
    .filter(([symbol, s]) => matches(query, symbol, s.shortname, s.longname ?? ''))
    .map(([symbol, s]) => ({
      symbol,
      quoteType: s.quoteType,
      shortname: s.shortname,
      longname: s.longname,
      exchDisp: s.exchDisp,
      typeDisp: s.typeDisp,
    }))
  return [200, { quotes, news: [] }]
}

function geckoPrice(ids) {
  const now = Math.floor(Date.now() / 1000)
  const prices = {}
  for (const id of ids.split(',')) {
    if (COINS[id]) prices[id] = { eur: COINS[id].price, last_updated_at: now }
  }
  return [200, prices]
}

function geckoChart(id) {
  const coin = COINS[id]
  if (!coin) return [404, { error: 'coin not found' }]
  return [200, { prices: year().map((ms) => [ms, coin.price]), market_caps: [], total_volumes: [] }]
}

function geckoSearch(query) {
  const coins = Object.entries(COINS)
    .filter(([id, c]) => matches(query, id, c.name, c.symbol))
    .map(([id, c]) => ({ id, name: c.name, api_symbol: id, symbol: c.symbol, market_cap_rank: c.rank }))
  return [200, { coins, exchanges: [], icos: [], categories: [], nfts: [] }]
}

function answer(url) {
  const params = url.searchParams
  const path = url.pathname
  let found = path.match(/^\/v8\/finance\/chart\/([^/]+)$/)
  if (found) return yahooChart(decodeURIComponent(found[1]))
  if (path === '/v1/finance/search') return yahooSearch(params.get('q') ?? '')
  if (path === '/api/v3/simple/price') return geckoPrice(params.get('ids') ?? '')
  found = path.match(/^\/api\/v3\/coins\/([^/]+)\/market_chart$/)
  if (found) return geckoChart(decodeURIComponent(found[1]))
  if (path === '/api/v3/search') return geckoSearch(params.get('query') ?? '')
  return [404, { error: `the local market does not serve ${path}` }]
}

/** Starts the market on a free local port. */
export async function startMarket() {
  const server = createServer((request, response) => {
    const [status, body] = answer(new URL(request.url, 'http://127.0.0.1'))
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

let running

// The test runner calls these once around the whole run; the addresses reach
// the test files through the environment they inherit.
export async function globalSetup() {
  running = await startMarket()
  process.env.ABACUS_MARKET_YAHOO_URL = running.url
  process.env.ABACUS_MARKET_COINGECKO_URL = running.url
}

export async function globalTeardown() {
  await running?.close()
  running = undefined
}
