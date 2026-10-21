/**
 * Where the market sources answer. The real addresses by default; the tests
 * point both at a local market with fixed data (scripts/test-market.mjs), so
 * no price, rate or search depends on the network. Read at each call rather
 * than once, so a process can be pointed elsewhere after this module loaded.
 */
export function yahooUrl(): string {
  return process.env.ABACUS_MARKET_YAHOO_URL || 'https://query1.finance.yahoo.com'
}

export function coinGeckoUrl(): string {
  return process.env.ABACUS_MARKET_COINGECKO_URL || 'https://api.coingecko.com'
}
