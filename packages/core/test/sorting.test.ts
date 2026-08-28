import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { today } from '../src/domain/period.ts'
import { resolveSort } from '../src/domain/sort.ts'
import {
  ACCOUNT_SORTS,
  createAccount,
  DEFAULT_ACCOUNT_SORT,
  listAccounts,
  sortAccounts,
} from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { recordBalanceCheck } from '../src/services/balanceChecks.ts'
import {
  CATEGORY_SORTS,
  createCategory,
  DEFAULT_CATEGORY_SORT,
  listCategories,
  sortCategories,
} from '../src/services/catalog.ts'
import {
  COMMITMENT_SORTS,
  createSubscription,
  DEFAULT_COMMITMENT_SORT,
  listCommitmentsWithProgress,
  sortCommitments,
} from '../src/services/commitments.ts'
import {
  declareAsset,
  listOperations,
  positions,
  recordOperations,
  setManualPrice,
} from '../src/services/investments.ts'
import {
  DEFAULT_MOVEMENT_SORT,
  declareMovement,
  listMovements,
  MOVEMENT_SORTS,
} from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** A fixed USD/EUR rate, so a foreign line ranks predictably and no network is reached. */
const RATES = async () => [{ quotedOn: today(), price: '0.5' }]

async function ledger(user: string) {
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const food = await createCategory(user, 'Food')
  const rent = await createCategory(user, 'Rent')
  const baker = await createActor(user, { name: 'Baker' })
  const landlord = await createActor(user, { name: 'Landlord' })

  await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 900,
    sourceAccountId: checking.id,
    targetActorId: landlord.id,
    categoryId: rent.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-03-10',
    amount: 12,
    sourceAccountId: checking.id,
    targetActorId: baker.id,
    categoryId: food.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-03-20',
    amount: 250,
    sourceAccountId: savings.id,
    targetActorId: baker.id,
    categoryId: food.id,
  })
  return { checking, savings }
}

test('a movement list orders on the column it is asked for, in both directions', async () => {
  const user = await seedUser()
  await ledger(user)

  const byDate = await listMovements(user)
  assert.deepEqual(
    byDate.map((m) => Number(m.amount)),
    [250, 12, 900],
  )

  const biggest = await listMovements(user, { sort: { field: 'amount', direction: 'desc' } })
  assert.deepEqual(
    biggest.map((m) => Number(m.amount)),
    [900, 250, 12],
  )

  const smallest = await listMovements(user, { sort: { field: 'amount', direction: 'asc' } })
  assert.deepEqual(
    smallest.map((m) => Number(m.amount)),
    [12, 250, 900],
  )
})

test('the limit cuts the ordered list, not the other way round', async () => {
  const user = await seedUser()
  await ledger(user)

  // The whole point of settling the order in SQL: the biggest expense of the
  // selection, not the biggest of the most recent page.
  const [top] = await listMovements(user, { limit: 1, sort: { field: 'amount', direction: 'desc' } })
  assert.equal(Number(top!.amount), 900)
})

test('a movement list orders on the names it displays, not on the ids it stores', async () => {
  const user = await seedUser()
  await ledger(user)

  const byCounterparty = await listMovements(user, { sort: { field: 'counterparty', direction: 'asc' } })
  assert.deepEqual(
    byCounterparty.map((m) => Number(m.amount)),
    // Baker twice (the recent one first, the tiebreaker being the date), then
    // Landlord.
    [250, 12, 900],
  )

  const byCategory = await listMovements(user, { sort: { field: 'category', direction: 'desc' } })
  assert.equal(Number(byCategory[0]!.amount), 900)
})

test('an unranked value stays last whichever way the list runs', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const priced = await declareAsset(user, { name: 'Priced', nature: 'other' })
  const unpriced = await declareAsset(user, { name: 'Unpriced', nature: 'other' })
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: priced.id,
      type: 'buy',
      quantity: 1,
      amount: 100,
      operatedOn: '2026-01-05',
    },
    {
      accountId: pea.id,
      assetId: unpriced.id,
      type: 'buy',
      quantity: 1,
      amount: 500,
      operatedOn: '2026-01-06',
    },
  ])

  await setManualPrice(user, priced.id, 100, '2026-02-01')

  const held = await positions(user, pea.id, { field: 'value', direction: 'desc' })
  assert.deepEqual(
    held.map((p) => p.assetName),
    ['Priced', 'Unpriced'],
  )

  // Reversed, the position with no price does not become the most valuable
  // one: what is unknown is not a small number.
  const reversed = await positions(user, pea.id, { field: 'value', direction: 'asc' })
  assert.deepEqual(
    reversed.map((p) => p.assetName),
    ['Priced', 'Unpriced'],
  )
})

test('holdings open on what weighs the most, not on the alphabet', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const alpha = await declareAsset(user, { name: 'Alpha', nature: 'other' })
  const omega = await declareAsset(user, { name: 'Omega', nature: 'other' })
  await recordOperations(user, [
    { accountId: pea.id, assetId: alpha.id, type: 'buy', quantity: 1, amount: 100, operatedOn: '2026-01-05' },
    { accountId: pea.id, assetId: omega.id, type: 'buy', quantity: 1, amount: 900, operatedOn: '2026-01-06' },
  ])
  await setManualPrice(user, alpha.id, 100, '2026-02-01')
  await setManualPrice(user, omega.id, 900, '2026-02-01')

  const held = await positions(user, pea.id)
  assert.deepEqual(
    held.map((p) => p.assetName),
    ['Omega', 'Alpha'],
  )
})

test('an operation list orders in SQL, so its limit holds the right rows', async () => {
  const user = await seedUser()
  const pea = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  const asset = await declareAsset(user, { name: 'Fund', nature: 'other' })
  await recordOperations(user, [
    { accountId: pea.id, assetId: asset.id, type: 'buy', quantity: 1, amount: 100, operatedOn: '2026-01-05' },
    { accountId: pea.id, assetId: asset.id, type: 'buy', quantity: 1, amount: 800, operatedOn: '2026-02-05' },
    { accountId: pea.id, assetId: asset.id, type: 'buy', quantity: 1, amount: 300, operatedOn: '2026-03-05' },
  ])

  const latest = await listOperations(user, { limit: 1 })
  assert.equal(Number(latest[0]!.amount), 300)

  const biggest = await listOperations(user, { sort: { field: 'amount', direction: 'desc' }, limit: 1 })
  assert.equal(Number(biggest[0]!.amount), 800)
})

test('commitments rank on euros, and what was never priced ranks last', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const actor = await createActor(user, { name: 'Provider' })
  const subscription = async (label: string, amount: number, currency?: string) =>
    await createSubscription(
      user,
      {
        label,
        actorId: actor.id,
        accountId: account.id,
        amount,
        periodUnit: 'month',
        firstDueOn: '2026-04-05',
        currency,
      },
      RATES,
    )

  await subscription('Cheap', 5)
  await subscription('Yearly', 240)
  // 100 USD at 0.5 is 50 euros a month: read on its face value it would rank
  // above the 240 line, which is what ranking in euros prevents.
  await subscription('Foreign', 100, 'USD')

  const listed = await listCommitmentsWithProgress(user, true, RATES)
  assert.deepEqual(
    sortCommitments(listed).map((c) => c.label),
    ['Yearly', 'Foreign', 'Cheap'],
  )
  assert.deepEqual(
    sortCommitments(listed, { field: 'label', direction: 'asc' }).map((c) => c.label),
    ['Cheap', 'Foreign', 'Yearly'],
  )
})

test('accounts rank on their last check, the never checked one first', async () => {
  const user = await seedUser()
  const checked = await createAccount({ userId: user, name: 'Checked', behavior: 'payment' })
  await createAccount({ userId: user, name: 'Never', behavior: 'savings' })
  await recordBalanceCheck(user, checked.id, 0, '2026-03-31')

  const state = (await listAccounts(user)).map((account) => ({
    account,
    lastCheckedOn: null as string | null,
  }))
  const withChecks = state.map((entry) =>
    entry.account.id === checked.id ? { ...entry, lastCheckedOn: '2026-03-31' } : entry,
  )

  assert.deepEqual(
    sortAccounts(withChecks, { field: 'checked', direction: 'asc' }).map((s) => s.account.name),
    // Never pointed is not a missing value: it is the oldest a check can be,
    // and the account that most needs one.
    ['Never', 'Checked'],
  )
  assert.deepEqual(
    sortAccounts(withChecks, { field: 'checked', direction: 'desc' }).map((s) => s.account.name),
    ['Checked', 'Never'],
  )
})

test('categories read grouped, and what has no group closes the list', async () => {
  const user = await seedUser()
  await createCategory(user, 'Rent', 'Home')
  await createCategory(user, 'Loose')
  await createCategory(user, 'Bread', 'Food')

  const categories = await listCategories(user)
  assert.deepEqual(
    sortCategories(categories, DEFAULT_CATEGORY_SORT).map((c) => c.name),
    ['Bread', 'Rent', 'Loose'],
  )
  assert.deepEqual(
    sortCategories(categories, { field: 'name', direction: 'asc' }).map((c) => c.name),
    ['Bread', 'Loose', 'Rent'],
  )
})

test('a criterion no list offers falls back to its default order', async () => {
  // A criterion belonging to another list is not one this one has.
  assert.deepEqual(
    resolveSort(MOVEMENT_SORTS, DEFAULT_MOVEMENT_SORT, 'balance', 'desc'),
    DEFAULT_MOVEMENT_SORT,
  )
  assert.deepEqual(resolveSort(ACCOUNT_SORTS, DEFAULT_ACCOUNT_SORT, 'balance', 'sideways'), {
    field: 'balance',
    // A direction that says nothing leaves the criterion's own default in place.
    direction: 'desc',
  })
  assert.deepEqual(resolveSort(COMMITMENT_SORTS, DEFAULT_COMMITMENT_SORT, undefined, 'asc'), {
    field: 'monthly',
    direction: 'desc',
  })
  assert.deepEqual(resolveSort(CATEGORY_SORTS, DEFAULT_CATEGORY_SORT, 'name', 'desc'), {
    field: 'name',
    direction: 'desc',
  })
})
