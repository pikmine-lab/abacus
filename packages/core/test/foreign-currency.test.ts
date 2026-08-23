import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import type { HistoricalPrice } from '../src/prices/sources.ts'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { correctMovement, declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** A year of USD/EUR closes as Yahoo would hand them, and how often it was asked. */
function stubHistory(closes: HistoricalPrice[] = [{ quotedOn: '2026-01-02', price: '0.9' }]) {
  const calls: string[] = []
  return {
    calls,
    history: async (_source: string, reference: string) => {
      calls.push(reference)
      return closes
    },
  }
}

async function seedLedger() {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })
  return { user, checking, shop }
}

test('declares an expense in USD: EUR counter-value at the day rate, original kept', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history, calls } = stubHistory()

  const movement = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 99,
      currency: 'usd',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )

  assert.equal(movement.amount, '89.10')
  assert.equal(movement.currency, 'EUR')
  assert.equal(movement.originalAmount, '99.00')
  assert.equal(movement.originalCurrency, 'USD')
  assert.deepEqual(calls, ['USDEUR=X'])

  // The pair is one shared instrument, and balances stay plain EUR sums.
  const [pair] = await db()<{ kind: string }[]>`
    select kind from instrument where price_source_ref = 'USDEUR=X'
  `
  assert.equal(pair?.kind, 'currency')
  const [account] = (await listAccounts(user)).filter((a) => a.id === checking.id)
  assert.equal(account?.balance, '-89.10')
})

test('a non-trading day reads the last close before it, without refetching', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history, calls } = stubHistory()

  await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 10,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )
  // Sunday the 4th: Friday's close serves, from the stored history.
  const weekend = await declareMovement(
    user,
    {
      happenedOn: '2026-01-04',
      amount: 10,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )

  assert.equal(weekend.amount, '9.00')
  assert.deepEqual(calls, ['USDEUR=X'])
})

test('the euros the bank moved win over the computed rate, without any fetch', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history, calls } = stubHistory()

  const movement = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 99,
      currency: 'USD',
      eurAmount: 91.35,
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )

  assert.equal(movement.amount, '91.35')
  assert.equal(movement.originalAmount, '99.00')
  assert.deepEqual(calls, [])
})

test('refuses a foreign transfer, a needless eurAmount and an unknown rate', async () => {
  const { user, checking, shop } = await seedLedger()
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-01-02',
      amount: 100,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetAccountId: savings.id,
    }),
    (e: DomainError) => e.code === 'transfer_stays_eur',
  )
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-01-02',
      amount: 100,
      eurAmount: 100,
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    }),
    (e: DomainError) => e.code === 'needless_eur_amount',
  )
  const { history } = stubHistory([])
  await assert.rejects(
    declareMovement(
      user,
      {
        happenedOn: '2026-01-02',
        amount: 100,
        currency: 'XXX',
        sourceAccountId: checking.id,
        targetActorId: shop.id,
      },
      history,
    ),
    (e: DomainError) => e.code === 'no_exchange_rate',
  )
})

test('a close too far from the movement day is not that day rate', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history } = stubHistory([{ quotedOn: '2026-01-02', price: '0.9' }])

  await assert.rejects(
    declareMovement(
      user,
      {
        happenedOn: '2026-03-01',
        amount: 100,
        currency: 'USD',
        sourceAccountId: checking.id,
        targetActorId: shop.id,
      },
      history,
    ),
    (e: DomainError) => e.code === 'no_exchange_rate',
  )
})

test('corrects the euros alone, redeclares the paid side, or drops a wrong original', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history } = stubHistory()
  const declared = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 99,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )

  // The statement shows the bank's own conversion: only the euros move.
  const restated = await correctMovement(user, declared.id, { amount: 90.52 })
  assert.equal(restated.amount, '90.52')
  assert.equal(restated.originalAmount, '99.00')
  assert.equal(restated.originalCurrency, 'USD')

  // The paid amount itself was mistyped: redeclared, reconverted at the day rate.
  const repaid = await correctMovement(user, declared.id, { amount: 89, currency: 'USD' }, history)
  assert.equal(repaid.originalAmount, '89.00')
  assert.equal(repaid.amount, '80.10')

  // It was never in dollars: EUR drops the original pair.
  const plain = await correctMovement(user, declared.id, { amount: 89, currency: 'EUR' })
  assert.equal(plain.amount, '89.00')
  assert.equal(plain.originalAmount, null)
  assert.equal(plain.originalCurrency, null)
})

test('correcting a foreign expense into a transfer drops the original', async () => {
  const { user, checking, shop } = await seedLedger()
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const { history } = stubHistory()
  const declared = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 99,
      currency: 'USD',
      sourceAccountId: checking.id,
      targetActorId: shop.id,
    },
    history,
  )

  // The euros move between two owned accounts: the foreign original would
  // dress an internal move as a payment, so it goes.
  const transfer = await correctMovement(user, declared.id, {
    amount: Number(declared.amount),
    sourceAccountId: checking.id,
    targetAccountId: savings.id,
    targetActorId: null,
  })
  assert.equal(transfer.kind, 'transfer')
  assert.equal(transfer.amount, '89.10')
  assert.equal(transfer.originalAmount, null)
  assert.equal(transfer.originalCurrency, null)
})

test('declares an income in a foreign currency too', async () => {
  const { user, checking, shop } = await seedLedger()
  const { history } = stubHistory([{ quotedOn: '2026-01-02', price: '0.85' }])

  const income = await declareMovement(
    user,
    {
      happenedOn: '2026-01-02',
      amount: 1000,
      currency: 'USD',
      sourceActorId: shop.id,
      targetAccountId: checking.id,
    },
    history,
  )

  assert.equal(income.kind, 'income')
  assert.equal(income.amount, '850.00')
  assert.equal(income.originalCurrency, 'USD')
})
