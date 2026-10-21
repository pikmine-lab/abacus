import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import { today } from '../src/domain/period.ts'
import { coinGeckoUrl, yahooUrl } from '../src/prices/endpoints.ts'
import { eurRateOn } from '../src/services/fx.ts'
import { setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

function withEnv(name: string, value: string | undefined, read: () => string): string {
  const saved = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return read()
  } finally {
    if (saved === undefined) delete process.env[name]
    else process.env[name] = saved
  }
}

test('the market addresses are the real sources when nothing overrides them', () => {
  assert.equal(withEnv('ABACUS_MARKET_YAHOO_URL', undefined, yahooUrl), 'https://query1.finance.yahoo.com')
  assert.equal(withEnv('ABACUS_MARKET_COINGECKO_URL', undefined, coinGeckoUrl), 'https://api.coingecko.com')
})

test('the market addresses are read from the environment at each call', () => {
  assert.equal(withEnv('ABACUS_MARKET_YAHOO_URL', 'http://127.0.0.1:1', yahooUrl), 'http://127.0.0.1:1')
  assert.equal(
    withEnv('ABACUS_MARKET_COINGECKO_URL', 'http://127.0.0.1:2', coinGeckoUrl),
    'http://127.0.0.1:2',
  )
})

// C5: under the test script, the network is cut and the market is local, so a
// conversion with nothing injected reads the local market's fixed rate.
test('a USD rate with no loader injected comes from the local market', async () => {
  assert.equal(Number(await eurRateOn(db(), 'USD', today())), 0.86)
})
