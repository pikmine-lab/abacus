import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import {
  declareAsset,
  listAssets,
  portfolio,
  positions,
  recordOperations,
  setManualPrice,
  stopFollowing,
  valuationHistory,
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

test('the average cost is sequential, not a division of totals', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })

  // Buy 10 for 1000 (100 each), sell half, then buy 5 for 1000 (200 each).
  // Walking the operations gives 150 a unit: the sale takes its share out of the
  // cost and leaves the average alone. Dividing the totals would say 133.33,
  // which is why the walk exists.
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'buy',
      quantity: 10,
      amount: 1000,
      operatedOn: '2026-01-05',
    },
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'sell',
      quantity: 5,
      amount: 700,
      operatedOn: '2026-02-05',
    },
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'buy',
      quantity: 5,
      amount: 1000,
      operatedOn: '2026-03-05',
    },
  ])

  const [position] = await positions(user)
  assert.equal(position!.quantity, '10.00000000')
  assert.equal(position!.averageCost, '150.00000000')
  assert.equal(position!.costBasis, '1500.00')
})

test("an investment account's balance is its cash, operations included", async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })

  // Funding the account is a movement: an internal transfer, neutral.
  await declareMovement(user, {
    happenedOn: '2026-01-02',
    amount: 5000,
    sourceAccountId: checking.id,
    targetAccountId: pea.id,
  })
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'buy',
      quantity: 3,
      amount: 3000,
      operatedOn: '2026-01-05',
    },
    { accountId: pea.id, type: 'fee', amount: 12, operatedOn: '2026-01-05' },
    { accountId: pea.id, assetId: world.id, type: 'dividend', amount: 40, operatedOn: '2026-02-01' },
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'sell',
      quantity: 1,
      amount: 1100,
      operatedOn: '2026-03-01',
    },
  ])

  const accounts = await listAccounts(user)
  const cash = accounts.find((a) => a.id === pea.id)!.balance
  assert.equal(cash, '3128.00') // 5000 - 3000 - 12 + 40 + 1100
  // The purchase never counted as spending: it left the checking account
  // untouched and the transfer is neutral by construction.
  assert.equal(accounts.find((a) => a.id === checking.id)!.balance, '-5000.00')

  const [held] = await portfolio(user)
  assert.equal(held!.cash, '3128.00')
  assert.equal(held!.positions.length, 1)
  assert.equal(held!.positions[0]!.quantity, '2.00000000')
  assert.equal(held!.costBasis, '2000.00')
})

test('a holding sold out stops being a position', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    { accountId: pea.id, assetId: world.id, type: 'buy', quantity: 4, amount: 400, operatedOn: '2026-01-05' },
    {
      accountId: pea.id,
      assetId: world.id,
      type: 'sell',
      quantity: 4,
      amount: 480,
      operatedOn: '2026-04-05',
    },
  ])
  assert.equal((await positions(user)).length, 0)
})

test('selling more than the account holds is refused', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    { accountId: pea.id, assetId: world.id, type: 'buy', quantity: 2, amount: 200, operatedOn: '2026-01-05' },
  ])
  await assert.rejects(
    recordOperations(user, [
      {
        accountId: pea.id,
        assetId: world.id,
        type: 'sell',
        quantity: 3,
        amount: 300,
        operatedOn: '2026-02-05',
      },
    ]),
    (e: DomainError) => e.code === 'oversold',
  )
})

test('only an investment account carries operations', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  await assert.rejects(
    recordOperations(user, [{ accountId: checking.id, type: 'fee', amount: 5, operatedOn: '2026-01-05' }]),
    (e: DomainError) => e.code === 'not_an_investment_account',
  )
})

test('a batch is one declaration: a bad line leaves nothing behind', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  await assert.rejects(
    recordOperations(user, [
      {
        accountId: pea.id,
        assetId: world.id,
        type: 'buy',
        quantity: 1,
        amount: 100,
        operatedOn: '2026-01-05',
      },
      {
        accountId: pea.id,
        assetId: world.id,
        type: 'sell',
        quantity: 9,
        amount: 900,
        operatedOn: '2026-01-06',
      },
    ]),
    (e: DomainError) => e.code === 'oversold',
  )
  assert.equal((await positions(user)).length, 0)
})

test('two users holding the same ETF share one instrument, under their own names', async () => {
  const pierre = await seedUser('user-1')
  const camille = await seedUser('user-2')
  const his = await declareAsset(pierre, { name: 'Monde', instrument: WORLD })
  const hers = await declareAsset(camille, { name: 'World ETF', instrument: WORLD })

  const [mine] = await listAssets(pierre)
  const [theirs] = await listAssets(camille)
  assert.notEqual(his.id, hers.id)
  assert.equal(mine!.instrumentId, theirs!.instrumentId)
  assert.equal(mine!.name, 'Monde')
  assert.equal(theirs!.name, 'World ETF')
  // The shared row keeps what the first declaration said: a second holder
  // cannot rename what everyone else reads.
  assert.equal(mine!.instrument!.name, 'Amundi MSCI World')
  assert.equal(theirs!.instrument!.name, 'Amundi MSCI World')
})

test('declaring the same instrument again returns the holding already there', async () => {
  const user = await seedUser()
  const first = await declareAsset(user, { name: 'World', instrument: WORLD })
  // One instrument is one holding: a second name would split the position in
  // half. Rather than refuse, this hands back what exists, which is what makes
  // "declare the asset and the operation together" safe to retry.
  const again = await declareAsset(user, { name: 'Monde', instrument: WORLD })
  assert.equal(again.id, first.id)
  assert.equal(again.name, 'World')
  assert.equal((await listAssets(user)).length, 1)
})

test('two hand-priced assets cannot share a name', async () => {
  const user = await seedUser()
  await declareAsset(user, { name: 'SCPI' })
  await assert.rejects(declareAsset(user, { name: 'SCPI' }), (e: DomainError) => e.code === 'asset_exists')
})

test('an asset priced by hand needs no instrument', async () => {
  const user = await seedUser()
  const scpi = await declareAsset(user, { name: 'SCPI Pierre' })
  assert.equal(scpi.instrumentId, null)
  const [only] = await listAssets(user)
  assert.equal(only!.instrument, null)
})

test('a followed asset is forgotten, one carrying operations is not', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const watched = await declareAsset(user, {
    name: 'Nasdaq',
    instrument: { ...WORLD, priceSourceRef: 'EQQQ.PA' },
  })
  const held = await declareAsset(user, { name: 'World', instrument: WORLD })
  await recordOperations(user, [
    { accountId: pea.id, assetId: held.id, type: 'buy', quantity: 1, amount: 100, operatedOn: '2026-01-05' },
  ])

  // Nothing happened on it, so there is nothing to lose.
  await stopFollowing(user, watched.id)
  assert.deepEqual(
    (await listAssets(user)).map((a) => a.name),
    ['World'],
  )

  // The other one is the account's history: forgetting it would take a position
  // and its cost basis with it.
  await assert.rejects(stopFollowing(user, held.id), (e: DomainError) => e.code === 'asset_has_operations')
})

/**
 * One holding priced by hand, so the curve can be driven day by day without a
 * market: prices on chosen dates, a cash account to contribute from, and the
 * investment account that holds it.
 */
async function pricedHolding(
  prices: [string, number][],
): Promise<{ user: string; checking: string; pea: string; asset: string }> {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const asset = await declareAsset(user, { name: 'SCPI Pierre' })
  for (const [on, price] of prices) await setManualPrice(user, asset.id, price, on)
  return { user, checking: checking.id, pea: pea.id, asset: asset.id }
}

test('there is no portfolio history until something has been bought', async () => {
  const user = await seedUser()
  assert.equal(await valuationHistory(user), null)
})

test('a contribution does not move the performance, a price does', async () => {
  const { user, checking, pea, asset } = await pricedHolding([
    ['2026-01-01', 100],
    ['2026-01-07', 120],
  ])
  await declareMovement(user, {
    happenedOn: '2026-01-01',
    amount: 1000,
    sourceAccountId: checking,
    targetAccountId: pea,
  })
  await recordOperations(user, [
    { accountId: pea, assetId: asset, type: 'buy', quantity: 10, amount: 1000, operatedOn: '2026-01-01' },
  ])
  // A second contribution, days later: both series rise by the same 1000, so
  // the gap between them, which is the performance, must not budge. That is the
  // whole reason this reading exists next to the valuation.
  await declareMovement(user, {
    happenedOn: '2026-01-05',
    amount: 1000,
    sourceAccountId: checking,
    targetAccountId: pea,
  })

  const history = await valuationHistory(user, '2026-01-01', '2026-01-08')
  assert.ok(history)
  assert.equal(history.step, 'day')
  const on = (day: string) => history.milestones.find((m) => m.day === day)!
  assert.equal(on('2026-01-01').performance, 0)
  assert.equal(on('2026-01-04').performance, 0)
  // The day the money landed: the valuation jumped, the performance did not.
  assert.equal(on('2026-01-05').value, 2000)
  assert.equal(on('2026-01-05').contributions, 2000)
  assert.equal(on('2026-01-05').performance, 0)
  // The day the price moved: 10 units at 120 instead of 100.
  assert.equal(on('2026-01-07').performance, 200)
  assert.equal(history.end.performance, 200)
})

test('a long window is milestoned by month ends, and a peak between two of them is kept', async () => {
  const { user, checking, pea, asset } = await pricedHolding([
    ['2026-01-01', 100],
    ['2026-01-15', 300],
    ['2026-01-16', 100],
  ])
  await declareMovement(user, {
    happenedOn: '2026-01-01',
    amount: 1000,
    sourceAccountId: checking,
    targetAccountId: pea,
  })
  await recordOperations(user, [
    { accountId: pea, assetId: asset, type: 'buy', quantity: 10, amount: 1000, operatedOn: '2026-01-01' },
  ])

  const history = await valuationHistory(user, '2026-01-01', '2026-03-10')
  assert.ok(history)
  assert.equal(history.step, 'month')
  // The last known day of each month, the window's own end included.
  assert.deepEqual(
    history.milestones.map((m) => m.day),
    ['2026-01-31', '2026-02-28', '2026-03-10'],
  )
  // Measured on every day, not on the milestones: mid-January is a peak no
  // month end ever saw.
  assert.equal(history.high.day, '2026-01-15')
  assert.equal(history.high.performance, 2000)
  assert.equal(history.low.performance, 0)
})

test('the window never reaches back before the first operation', async () => {
  const { user, checking, pea, asset } = await pricedHolding([['2026-01-05', 100]])
  await declareMovement(user, {
    happenedOn: '2026-01-05',
    amount: 100,
    sourceAccountId: checking,
    targetAccountId: pea,
  })
  await recordOperations(user, [
    { accountId: pea, assetId: asset, type: 'buy', quantity: 1, amount: 100, operatedOn: '2026-01-05' },
  ])

  const history = await valuationHistory(user, '2020-01-01', '2026-01-08')
  assert.ok(history)
  assert.equal(history.from, '2026-01-05')
  assert.equal(history.start.day, '2026-01-05')
})
