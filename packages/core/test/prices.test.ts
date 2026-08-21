import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { parseGeckoSearch, parseYahooSearch } from '../src/prices/search.ts'
import { parseCoinGecko, parseYahoo, type Quote } from '../src/prices/sources.ts'
import { createAccount } from '../src/services/accounts.ts'
import {
  declareAsset,
  portfolio,
  positions,
  recordOperations,
  refreshQuotes,
  setManualPrice,
} from '../src/services/investments.ts'
import { declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

const WORLD = {
  kind: 'security' as const,
  priceSource: 'yahoo' as const,
  priceSourceRef: 'CW8.PA',
  name: 'Amundi MSCI World',
}

/** A source answer, frozen: parsing must not need the network to be tested. */
const YAHOO_PAYLOAD = {
  chart: {
    result: [
      {
        meta: {
          currency: 'EUR',
          symbol: 'CW8.PA',
          regularMarketPrice: 688.01,
          regularMarketTime: 1787326512,
          exchangeTimezoneName: 'Europe/Paris',
          currentTradingPeriod: { start: 1787295600, end: 1787326200 },
        },
      },
    ],
  },
}

test('a Yahoo answer parses to a price, its hour, and whether its venue was trading', () => {
  const quote = parseYahoo(YAHOO_PAYLOAD)
  assert.equal(quote.price, '688.01')
  assert.equal(quote.currency, 'EUR')
  assert.equal(quote.quotedAt.getTime(), 1787326512 * 1000)
  // The session window closed at 1787326200, before the quote was stamped: this
  // is a closing price, and the venue is shut.
  assert.equal(quote.marketOpen, false)
})

test('an unusable answer is an error, never a zero', () => {
  assert.throws(() => parseYahoo({ chart: { result: [] } }))
  assert.throws(() => parseYahoo({}))
  assert.throws(() => parseCoinGecko({ bitcoin: {} }, 'bitcoin'))
})

test('a CoinGecko answer parses in euros, and crypto never closes', () => {
  const quote = parseCoinGecko({ bitcoin: { eur: 66239, last_updated_at: 1787327770 } }, 'bitcoin')
  assert.equal(quote.price, '66239')
  assert.equal(quote.currency, 'EUR')
  assert.equal(quote.marketOpen, true)
})

test('search keeps what can be held, and orders coins by market cap', () => {
  const securities = parseYahooSearch({
    quotes: [
      {
        symbol: 'CW8.PA',
        longname: 'Amundi MSCI World',
        quoteType: 'ETF',
        exchDisp: 'Paris',
        typeDisp: 'ETF',
      },
      { symbol: '^N100', shortname: 'Euronext 100', quoteType: 'INDEX' },
      { symbol: 'AAPL', shortname: 'Apple', quoteType: 'EQUITY', exchDisp: 'NASDAQ' },
    ],
  })
  // An index is not something one holds, so it does not turn up as a candidate.
  assert.deepEqual(
    securities.map((h) => h.reference),
    ['CW8.PA', 'AAPL'],
  )
  assert.equal(securities[0]!.venue, 'Paris')

  const coins = parseGeckoSearch({
    coins: [
      { id: 'bitcoin-cash-sv', symbol: 'bsv', name: 'Bitcoin SV', market_cap_rank: 120 },
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 },
      { id: 'dog-bitcoin', symbol: 'dog', name: 'Dog (Bitcoin)', market_cap_rank: null },
    ],
  })
  assert.deepEqual(
    coins.map((h) => h.reference),
    ['bitcoin', 'bitcoin-cash-sv', 'dog-bitcoin'],
  )
  assert.equal(coins[0]!.name, 'Bitcoin (BTC)')
})

/** A fetcher that counts its calls, so the freshness bound can be observed. */
function stubFetcher(quote: Partial<Quote> = {}) {
  const calls: string[] = []
  const fetcher = async (_source: 'yahoo' | 'coingecko', reference: string): Promise<Quote> => {
    calls.push(reference)
    return {
      price: '700',
      currency: 'EUR',
      quotedAt: new Date('2026-08-21T15:35:00Z'),
      marketOpen: true,
      ...quote,
    }
  }
  return { fetcher, calls }
}

test('a refreshed price values the position, and the freshness bound stops the next call', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'buy',
      quantity: 2,
      amount: 1300,
      operatedOn: '2026-08-05',
    },
  ])

  const { fetcher, calls } = stubFetcher()
  await refreshQuotes(user, fetcher)
  assert.deepEqual(calls, ['CW8.PA'])

  const [position] = await positions(user)
  assert.equal(position!.price, '700.00000000')
  assert.equal(position!.value, '1400.00')
  assert.equal(position!.gain, '100.00') // 1400 held against 1300 paid
  assert.equal(position!.manualPrice, false)
  assert.ok(position!.pricedAt instanceof Date)

  // Asked again straight away: the price cannot have moved by more than the
  // licence delay, so no second call goes out.
  await refreshQuotes(user, fetcher)
  assert.deepEqual(calls, ['CW8.PA'])
})

test('a price in another currency is refused rather than mixed into euros', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'CTO', behavior: 'investment' })
  const apple = await declareAsset(user, {
    name: 'Apple',
    instrument: { ...WORLD, priceSourceRef: 'AAPL', name: 'Apple Inc.' },
  })
  await recordOperations(user, [
    { accountId: pea.id, assetId: apple.id, type: 'buy', quantity: 1, amount: 250, operatedOn: '2026-08-05' },
  ])

  const { fetcher } = stubFetcher({ currency: 'USD', price: '309' })
  await refreshQuotes(user, fetcher)
  const [position] = await positions(user)
  assert.equal(position!.price, null)
  assert.equal(position!.value, null)
})

test('a source that fails leaves the read standing', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    { accountId: pea.id, assetId: world.id, type: 'buy', quantity: 1, amount: 650, operatedOn: '2026-08-05' },
  ])
  await refreshQuotes(user, async () => {
    throw new Error('Yahoo answered 429')
  })
  const [position] = await positions(user)
  assert.equal(position!.price, null)
  assert.equal(position!.costBasis, '650.00')
})

test('what no source quotes takes a hand-typed price, and a quoted asset refuses one', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const scpi = await declareAsset(user, { name: 'SCPI' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: scpi.id,
      type: 'buy',
      quantity: 10,
      amount: 1000,
      operatedOn: '2026-01-05',
    },
  ])

  await setManualPrice(user, scpi.id, 105, '2026-08-20')
  const [position] = await positions(user)
  assert.equal(position!.value, '1050.00')
  assert.equal(position!.manualPrice, true)

  await assert.rejects(
    setManualPrice(user, world.id, 700, '2026-08-20'),
    (e: DomainError) => e.code === 'asset_is_quoted',
  )
})

test('the account return includes dividends and fees, and says nothing when a price is missing', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  const scpi = await declareAsset(user, { name: 'SCPI' })

  await declareMovement(user, {
    happenedOn: '2026-08-01',
    amount: 2000,
    sourceAccountId: checking.id,
    targetAccountId: pea.id,
  })
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'buy',
      quantity: 2,
      amount: 1300,
      operatedOn: '2026-08-05',
    },
    { accountId: pea.id, type: 'fee', amount: 10, operatedOn: '2026-08-05' },
    { accountId: pea.id, assetId: world.id, type: 'dividend', amount: 30, operatedOn: '2026-08-12' },
    { accountId: pea.id, assetId: scpi.id, type: 'buy', quantity: 1, amount: 500, operatedOn: '2026-08-13' },
  ])

  const { fetcher } = stubFetcher()
  await refreshQuotes(user, fetcher)

  // The SCPI has no price yet, so the account cannot state a return.
  const [partial] = await portfolio(user)
  assert.equal(partial!.unpriced, 1)
  assert.equal(partial!.totalReturn, null)
  assert.equal(partial!.netContributions, '2000.00')

  await setManualPrice(user, scpi.id, 520, '2026-08-20')
  const [whole] = await portfolio(user)
  assert.equal(whole!.unpriced, 0)
  // Cash 220 (2000 - 1300 - 10 + 30 - 500), holdings 1400 + 520 = 1920.
  assert.equal(whole!.cash, '220.00')
  assert.equal(whole!.value, '2140.00')
  // 140 above the 2000 put in: 100 of unrealized gain on the ETF, 20 on the
  // SCPI, 30 of dividend received, 10 of fees paid.
  assert.equal(whole!.totalReturn, '140.00')
})
