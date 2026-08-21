import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { parseCoinGeckoHistory, parseYahooHistory } from '../src/prices/sources.ts'
import { createAccount } from '../src/services/accounts.ts'
import { recordBalanceCheck } from '../src/services/balanceChecks.ts'
import {
  correctOperation,
  declareAsset,
  deleteOperation,
  listOperations,
  positions,
  recordOperations,
  setManualPrice,
  valuation,
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

async function pea(user: string) {
  return await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
}

test('a mistyped amount is corrected, and the average cost follows', async () => {
  const user = await seedUser()
  const account = await pea(user)
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  const [bought] = await recordOperations(user, [
    // 130 a unit typed as 1300: exactly the slip that would misstate the
    // holding for as long as it is held.
    {
      accountId: account.id,
      assetId: world.id,
      type: 'buy',
      quantity: 10,
      amount: 13000,
      operatedOn: '2026-01-05',
    },
  ])
  assert.equal((await positions(user))[0]!.averageCost, '1300.00000000')

  await correctOperation(user, bought!.id, { amount: 1300 })
  const [fixed] = await positions(user)
  assert.equal(fixed!.averageCost, '130.00000000')
  assert.equal(fixed!.costBasis, '1300.00')
})

test('an operation that never happened is deleted', async () => {
  const user = await seedUser()
  const account = await pea(user)
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  const [, fee] = await recordOperations(user, [
    {
      accountId: account.id,
      assetId: world.id,
      type: 'buy',
      quantity: 2,
      amount: 300,
      operatedOn: '2026-01-05',
    },
    { accountId: account.id, type: 'fee', amount: 9, operatedOn: '2026-01-05' },
  ])
  await deleteOperation(user, fee!.id)
  assert.equal((await listOperations(user)).length, 1)
  // The cash follows: the fee never left the account.
  const [position] = await positions(user)
  assert.equal(position!.costBasis, '300.00')
})

test('a correction cannot leave a sale selling what was never held', async () => {
  const user = await seedUser()
  const account = await pea(user)
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  const [bought] = await recordOperations(user, [
    {
      accountId: account.id,
      assetId: world.id,
      type: 'buy',
      quantity: 10,
      amount: 1000,
      operatedOn: '2026-01-05',
    },
    {
      accountId: account.id,
      assetId: world.id,
      type: 'sell',
      quantity: 8,
      amount: 900,
      operatedOn: '2026-02-05',
    },
  ])

  // Cutting the purchase down to 5 would leave the later sale of 8 impossible,
  // and every average cost after it meaningless. Checking the final quantity
  // would not catch it: it is the running one that goes negative.
  await assert.rejects(
    correctOperation(user, bought!.id, { quantity: 5 }),
    (e: DomainError) => e.code === 'oversold',
  )
  // Refused as a whole: the amount is untouched too.
  assert.equal((await listOperations(user))[1]!.quantity, '10.00000000')

  await assert.rejects(deleteOperation(user, bought!.id), (e: DomainError) => e.code === 'oversold')
})

test('what a correction may not touch is what would make it another operation', async () => {
  const user = await seedUser()
  const account = await pea(user)
  const [fee] = await recordOperations(user, [
    { accountId: account.id, type: 'fee', amount: 12, operatedOn: '2026-01-05' },
  ])
  await assert.rejects(
    correctOperation(user, fee!.id, { quantity: 3 }),
    (e: DomainError) => e.code === 'unexpected_quantity',
  )
  await assert.rejects(
    correctOperation(user, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { amount: 5 }),
    (e: DomainError) => e.code === 'operation_not_found',
  )
})

test('the valuation curve walks quantities and the closes known on each day', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })
  const account = await pea(user)
  const scpi = await declareAsset(user, { name: 'SCPI' })

  await declareMovement(user, {
    happenedOn: '2026-01-02',
    amount: 1000,
    sourceAccountId: checking.id,
    targetAccountId: account.id,
  })
  await recordOperations(user, [
    {
      accountId: account.id,
      assetId: scpi.id,
      type: 'buy',
      quantity: 10,
      amount: 800,
      operatedOn: '2026-01-10',
    },
  ])
  await setManualPrice(user, scpi.id, 90, '2026-01-15')

  const series = await valuation(user, '2026-01-01', '2026-01-20')
  const on = (day: string) => series.find((p) => p.day === day)!

  // Before the transfer: nothing anywhere, and no contributions either.
  assert.equal(on('2026-01-01').holdings, '0.00')
  assert.equal(on('2026-01-01').contributions, '0.00')
  // Funded but not invested: cash only, and the contribution is on the board.
  assert.equal(on('2026-01-05').cash, '1000.00')
  assert.equal(on('2026-01-05').holdings, '0.00')
  // Bought before any price was known: the oldest price there is gets carried
  // backwards, because the holding existed and was not worth zero. A curve
  // dropping to the floor would draw a crash that never happened, which is a
  // worse lie than an approximation the window names. The current figure keeps
  // the opposite rule and stays unvalued, because it is read as exact.
  assert.equal(on('2026-01-12').cash, '200.00')
  assert.equal(on('2026-01-12').holdings, '900.00')
  // Priced at 90: ten units are worth 900, and the price carries forward to
  // the days that follow, market or not.
  assert.equal(on('2026-01-15').holdings, '900.00')
  assert.equal(on('2026-01-20').holdings, '900.00')
  assert.equal(on('2026-01-20').contributions, '1000.00')
})

test('a year of closes parses, and the running day is skipped', () => {
  const yahoo = parseYahooHistory({
    chart: {
      result: [
        {
          timestamp: [1787001600, 1787088000, 1787174400],
          // The day still trading has no adjusted close: writing a zero there
          // would draw a cliff at the right edge of every curve.
          indicators: { adjclose: [{ adjclose: [688.01, 690.5, null] }] },
        },
      ],
    },
  })
  assert.equal(yahoo.length, 2)
  assert.equal(yahoo[0]!.price, '688.01')
  assert.match(yahoo[0]!.quotedOn, /^\d{4}-\d{2}-\d{2}$/)

  const gecko = parseCoinGeckoHistory({
    prices: [
      [1787001600000, 66000],
      [1787088000000, 66500],
      // Two points on one day: the later one wins, one row per day.
      [1787088000000 + 3600_000, 66900],
    ],
  })
  assert.equal(gecko.length, 2)
  assert.equal(gecko[1]!.price, '66900')
})

test('a balance check on an investment account sees its operations', async () => {
  const user = await seedUser()
  const account = await pea(user)
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  // A holding declared without the transfer that funded it: exactly how an
  // existing portfolio gets typed in, and what leaves the cash deeply negative.
  await recordOperations(user, [
    {
      accountId: account.id,
      assetId: world.id,
      type: 'buy',
      quantity: 8,
      amount: 4795.1,
      operatedOn: '2026-08-22',
    },
  ])

  // The check is the way out: reality says the cash is 12,50, the computed cash
  // is minus what was spent, and the gap is the contribution never declared.
  // Counting movements alone would have reported no gap at all, which is the
  // one thing a balance check exists to catch.
  const { check, gap } = await recordBalanceCheck(user, account.id, 12.5, '2026-08-22')
  assert.equal(check.computedBalance, '-4795.10')
  assert.equal(gap, 4807.6)
})
