import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { closeAccount, createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, createCategory } from '../src/services/catalog.ts'
import { declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('derives the movement kind from its endpoints', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const shop = await createActor(user, { name: 'Shop' })

  const transfer = await declareMovement(user, {
    happenedOn: '2026-01-05',
    amount: 200,
    sourceAccountId: checking.id,
    targetAccountId: savings.id,
  })
  const expense = await declareMovement(user, {
    happenedOn: '2026-01-06',
    amount: 30,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
  })
  const income = await declareMovement(user, {
    happenedOn: '2026-01-07',
    amount: 1000,
    sourceActorId: shop.id,
    targetAccountId: checking.id,
  })

  assert.equal(transfer.kind, 'transfer')
  assert.equal(expense.kind, 'expense')
  assert.equal(income.kind, 'income')
})

test('computes account balances from movements', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const employer = await createActor(user, { name: 'Employer' })
  const shop = await createActor(user, { name: 'Shop' })

  await declareMovement(user, {
    happenedOn: '2026-01-01',
    amount: 2000,
    sourceActorId: employer.id,
    targetAccountId: checking.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-01-02',
    amount: 500,
    sourceAccountId: checking.id,
    targetAccountId: savings.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-01-03',
    amount: 49.99,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
  })

  const accounts = await listAccounts(user)
  const byName = Object.fromEntries(accounts.map((a) => [a.name, a.balance]))
  assert.equal(byName.Checking, '1450.01')
  assert.equal(byName.Savings, '500.00')
})

test('inherits the activity from the external actor at write time, overridable', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const freelance = await createActivity(user, 'Freelance')
  const client = await createActor(user, { name: 'ACME', activityId: freelance.id })

  const inherited = await declareMovement(user, {
    happenedOn: '2026-02-01',
    amount: 1200,
    sourceActorId: client.id,
    targetAccountId: checking.id,
  })
  const overridden = await declareMovement(user, {
    happenedOn: '2026-02-02',
    amount: 50,
    sourceActorId: client.id,
    targetAccountId: checking.id,
    activityId: null,
  })

  assert.equal(inherited.activityId, freelance.id)
  assert.equal(overridden.activityId, null)
})

test('rejects a categorized transfer and a movement on a closed account', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const shop = await createActor(user, { name: 'Shop' })
  const groceries = await createCategory(user, 'Groceries')

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-01-05',
      amount: 10,
      sourceAccountId: checking.id,
      targetAccountId: savings.id,
      categoryId: groceries.id,
    }),
    (e: DomainError) => e.code === 'transfer_has_no_category',
  )

  await closeAccount(user, savings.id, '2026-01-31')
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-02-15',
      amount: 10,
      sourceAccountId: savings.id,
      targetActorId: shop.id,
    }),
    (e: DomainError) => e.code === 'account_closed',
  )
})

test('scopes every reference to the user', async () => {
  const user = await seedUser('user-1')
  const other = await seedUser('user-2')
  const mine = await createAccount({ userId: user, name: 'Mine', behavior: 'payment' })
  const theirActor = await createActor(other, { name: 'Their shop' })

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-01-05',
      amount: 10,
      sourceAccountId: mine.id,
      targetActorId: theirActor.id,
    }),
    (e: DomainError) => e.code === 'actor_not_found',
  )
})
