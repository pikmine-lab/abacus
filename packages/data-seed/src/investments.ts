import { createInvestmentPlan } from '@abacus/core/services/commitments'
import { declareAsset, recordOperations, setManualPrice } from '@abacus/core/services/investments'
import { declareMovement } from '@abacus/core/services/movements'
import { addDays, dayOfMonthAgo, daysAgo, firstMonthlyDue, HISTORY_START, random } from './calendar.ts'
import type { Ledger } from './ledger.ts'
import { confirmEach, dueDates } from './schedule.ts'

/**
 * Public instruments, which belong to no one: the app reads their prices
 * itself when a screen opens. The purchase prices below are rough levels of
 * the past year (a world ETF around 6 €, bitcoin around 80 000 €), close
 * enough that the gains the app computes against the real quotes look
 * ordinary. Offline, the quoted lines simply show as not priced.
 */
const WORLD = {
  kind: 'fund' as const,
  priceSource: 'yahoo' as const,
  priceSourceRef: 'DCAM.PA',
  name: 'Amundi PEA Monde (MSCI World) UCITS ETF',
  symbol: 'DCAM',
}
const WORLD_PRICE = 5.8
const SP500 = {
  kind: 'fund' as const,
  priceSource: 'yahoo' as const,
  priceSourceRef: 'ESE.PA',
  name: 'BNP Paribas Easy S&P 500 UCITS ETF',
  symbol: 'ESE',
}
const BITCOIN = {
  kind: 'crypto' as const,
  priceSource: 'coingecko' as const,
  priceSourceRef: 'bitcoin',
  name: 'Bitcoin',
  symbol: 'BTC',
}
const BITCOIN_PRICE = 80000

/**
 * Three investment accounts and their four masses: a world ETF bought every
 * month by a scheduled placement, bitcoin bought and partly sold, an SCPI no
 * market quotes, priced by hand and paying its dividends, and an S&P 500 ETF
 * only followed. Money reaches each account as a transfer first, as it does in
 * reality: a purchase is never an expense.
 */
export async function investments(userId: string, { accounts }: Ledger) {
  const next = random(2026)
  const near = (price: number, spread: number) =>
    Math.round(price * (1 + (next() - 0.5) * spread) * 1000) / 1000

  const world = await declareAsset(userId, { name: 'ETF Monde', instrument: WORLD })
  await declareAsset(userId, { name: 'ETF S&P 500', instrument: SP500 })
  const bitcoin = await declareAsset(userId, { name: 'Bitcoin', instrument: BITCOIN })
  const scpi = await declareAsset(userId, { name: 'SCPI Patrimoine Démo', nature: 'real_estate' })

  const transfer = (happenedOn: string, amount: number, targetAccountId: string) =>
    declareMovement(userId, { happenedOn, amount, sourceAccountId: accounts.checking, targetAccountId })

  // The PEA opens with a lump sum, then the plan buys every month on the 6th.
  const opening = addDays(HISTORY_START, 10)
  await transfer(opening, 1500, accounts.pea)
  const openingPrice = near(WORLD_PRICE, 0.08)
  const openingQuantity = Math.floor(1500 / openingPrice)
  await recordOperations(userId, [
    {
      accountId: accounts.pea,
      assetId: world.id,
      type: 'buy',
      quantity: openingQuantity,
      unitPrice: openingPrice,
      operatedOn: opening,
    },
    { accountId: accounts.pea, type: 'fee', amount: 1.99, operatedOn: opening, note: "Frais d'ordre" },
  ])
  const planFirst = firstMonthlyDue(6)
  const plan = await createInvestmentPlan(userId, {
    label: 'Versement mensuel PEA',
    accountId: accounts.checking,
    targetAccountId: accounts.pea,
    assetId: world.id,
    amount: 200,
    periodUnit: 'month',
    firstDueOn: planFirst,
  })
  // The broker buys whole shares: what is left of each instalment stays in cash.
  await confirmEach(userId, plan.id, dueDates(planFirst, 'month', 1, daysAgo(1)), () => {
    const price = near(WORLD_PRICE, 0.12)
    const quantity = Math.floor(200 / price)
    return { quantity, investedAmount: Math.round(quantity * price * 100) / 100 }
  })

  // Bitcoin: three buys over the year, a partial sale this summer.
  await transfer(addDays(HISTORY_START, 25), 900, accounts.crypto)
  const buys = [addDays(HISTORY_START, 26), dayOfMonthAgo(8, 3), dayOfMonthAgo(5, 3)]
  await recordOperations(
    userId,
    buys.map((operatedOn) => {
      const price = near(BITCOIN_PRICE, 0.3)
      return {
        accountId: accounts.crypto,
        assetId: bitcoin.id,
        type: 'buy' as const,
        quantity: Math.round((300 / price) * 1e6) / 1e6,
        amount: 300,
        operatedOn,
      }
    }),
  )
  await recordOperations(userId, [
    {
      accountId: accounts.crypto,
      assetId: bitcoin.id,
      type: 'sell',
      quantity: 0.002,
      unitPrice: near(BITCOIN_PRICE, 0.2),
      operatedOn: dayOfMonthAgo(3, 14),
    },
  ])

  // The SCPI: bought once, priced by hand twice, paying every quarter.
  const scpiBought = addDays(HISTORY_START, 14)
  await transfer(scpiBought, 2400, accounts.lifeInsurance)
  await recordOperations(userId, [
    {
      accountId: accounts.lifeInsurance,
      assetId: scpi.id,
      type: 'buy',
      quantity: 12,
      unitPrice: 200,
      operatedOn: scpiBought,
    },
  ])
  await setManualPrice(userId, scpi.id, 200, scpiBought)
  await setManualPrice(userId, scpi.id, 204.5, dayOfMonthAgo(2, 1))
  for (const months of [10, 7, 4, 1])
    await recordOperations(userId, [
      {
        accountId: accounts.lifeInsurance,
        assetId: scpi.id,
        type: 'dividend',
        amount: 27.6,
        operatedOn: dayOfMonthAgo(months, 25),
      },
    ])
  await recordOperations(userId, [
    {
      accountId: accounts.lifeInsurance,
      type: 'fee',
      amount: 14.4,
      operatedOn: dayOfMonthAgo(1, 31),
      note: 'Frais de gestion annuels',
    },
  ])
}
