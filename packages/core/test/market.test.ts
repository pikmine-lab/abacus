import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { globalSetup, globalTeardown, type Market, startMarket } from '@abacus/test-harness/market'
import { parseGeckoSearch, parseYahooSearch } from '../src/prices/search.ts'
import {
  parseCoinGecko,
  parseCoinGeckoHistory,
  parseYahoo,
  parseYahooHistory,
} from '../src/prices/sources.ts'

/**
 * The local market answers on the paths the app calls, in the shapes the app's
 * own parsers read: a fake that drifted from the real sources would let the
 * tests pass on data the app never sees.
 */

let market: Market
before(async () => {
  market = await startMarket()
})
after(() => market.close())

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${market.url}${path}`)
  return { status: response.status, body: await response.json() }
}

const today = new Date().toISOString().slice(0, 10)

test('a Yahoo quote of a known share parses to its price and currency', async () => {
  const { status, body } = await get('/v8/finance/chart/ACME?interval=1d&range=1d')
  assert.equal(status, 200)
  const quote = parseYahoo(body)
  assert.equal(quote.price, '180')
  assert.equal(quote.currency, 'USD')
  assert.equal(quote.kind, 'equity')
})

test('a Yahoo quote of a known fund in euros parses as a fund', async () => {
  const quote = parseYahoo((await get('/v8/finance/chart/WRLD.PA?interval=1d&range=1d')).body)
  assert.equal(quote.price, '520')
  assert.equal(quote.currency, 'EUR')
  assert.equal(quote.kind, 'fund')
})

test('a Yahoo year of USD/EUR and GBP/EUR closes runs up to today, at a fixed rate', async () => {
  for (const [pair, rate] of [
    ['USDEUR=X', '0.86'],
    ['GBPEUR=X', '1.15'],
  ]) {
    const history = parseYahooHistory((await get(`/v8/finance/chart/${pair}?interval=1d&range=1y`)).body)
    assert.ok(history.length >= 360, `${pair}: ${history.length} closes`)
    assert.equal(history.at(-1)?.quotedOn, today)
    assert.ok(history.every((close) => close.price === rate))
  }
})

test('a Yahoo symbol nobody knows answers 404, as Yahoo does', async () => {
  const { status, body } = await get('/v8/finance/chart/NOPE?interval=1d&range=1d')
  assert.equal(status, 404)
  assert.equal((body as { chart: { result: unknown } }).chart.result, null)
})

test('a Yahoo search finds the known share, and nothing for an unknown term', async () => {
  const hits = parseYahooSearch((await get('/v1/finance/search?q=acme&quotesCount=25&newsCount=0')).body)
  assert.deepEqual(
    hits.map((hit) => hit.symbol),
    ['ACME'],
  )
  assert.deepEqual(parseYahooSearch((await get('/v1/finance/search?q=zzz')).body), [])
})

test('a CoinGecko price of a known coin parses in euros, and an unknown id gets nothing', async () => {
  const quote = parseCoinGecko(
    (await get('/api/v3/simple/price?ids=bitcoin&vs_currencies=eur&include_last_updated_at=true')).body,
    'bitcoin',
  )
  assert.equal(quote.price, '60000')
  assert.equal(quote.currency, 'EUR')
  assert.deepEqual((await get('/api/v3/simple/price?ids=nope&vs_currencies=eur')).body, {})
})

test('a CoinGecko year of a known coin runs up to today, and an unknown coin answers 404', async () => {
  const history = parseCoinGeckoHistory(
    (await get('/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=365&interval=daily')).body,
  )
  assert.ok(history.length >= 360)
  assert.equal(history.at(-1)?.quotedOn, today)
  assert.equal((await get('/api/v3/coins/nope/market_chart?vs_currency=eur&days=365')).status, 404)
})

test('a CoinGecko search finds the known coin, and nothing for an unknown term', async () => {
  const hits = parseGeckoSearch((await get('/api/v3/search?query=bitcoin')).body)
  assert.deepEqual(
    hits.map((hit) => hit.reference),
    ['bitcoin'],
  )
  assert.deepEqual(parseGeckoSearch((await get('/api/v3/search?query=zzz')).body), [])
})

test('the global setup points both market addresses at a local market, and the teardown stops it', async () => {
  const saved = { yahoo: process.env.ABACUS_MARKET_YAHOO_URL, gecko: process.env.ABACUS_MARKET_COINGECKO_URL }
  try {
    await globalSetup()
    const yahoo = process.env.ABACUS_MARKET_YAHOO_URL ?? ''
    const gecko = process.env.ABACUS_MARKET_COINGECKO_URL ?? ''
    assert.match(yahoo, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.match(gecko, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal((await fetch(`${yahoo}/v8/finance/chart/ACME?range=1d`)).status, 200)
    assert.equal((await fetch(`${gecko}/api/v3/search?query=bitcoin`)).status, 200)
    await globalTeardown()
    await assert.rejects(fetch(`${yahoo}/v8/finance/chart/ACME?range=1d`))
  } finally {
    process.env.ABACUS_MARKET_YAHOO_URL = saved.yahoo
    process.env.ABACUS_MARKET_COINGECKO_URL = saved.gecko
    if (saved.yahoo === undefined) delete process.env.ABACUS_MARKET_YAHOO_URL
    if (saved.gecko === undefined) delete process.env.ABACUS_MARKET_COINGECKO_URL
  }
})
