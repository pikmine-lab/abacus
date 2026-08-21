import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { closeAccount, createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, createCategory } from '../src/services/catalog.ts'
import { correctMovement, declareMovement, deleteMovement, listMovements } from '../src/services/movements.ts'
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

test('correcting a movement re-derives its kind and keeps its origin links', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })
  const shop = await createActor(user, { name: 'Shop' })
  const friend = await createActor(user, { name: 'Friend' })
  const dining = await createCategory(user, 'Dining')

  const advance = await declareMovement(user, {
    happenedOn: '2026-02-10',
    amount: 90,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    categoryId: dining.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 90,
    note: 'diner',
  })

  // A typo on the amount and the date, nothing else.
  const fixed = await correctMovement(user, advance.id, { amount: 95.5, happenedOn: '2026-02-11' })
  assert.equal(fixed.amount, '95.50')
  assert.equal(fixed.happenedOn, '2026-02-11')
  assert.equal(fixed.kind, 'expense')
  assert.equal(fixed.categoryId, dining.id)
  assert.equal(fixed.note, 'diner')
  // A correction that says nothing about the claim leaves it alone.
  assert.equal(fixed.expectedRefundFromActorId, friend.id)
  assert.equal(fixed.expectedRefundAmount, '90.00')

  // Reclassifying the counterparty keeps the row valid and re-derives nothing
  // it should not: an expense stays an expense when the actor changes.
  const other = await createActor(user, { name: 'Other shop' })
  const moved = await correctMovement(user, advance.id, { targetActorId: other.id })
  assert.equal(moved.targetActorId, other.id)
  assert.equal(moved.kind, 'expense')

  // Turning it into an internal transfer is refused: the advance link on it
  // only makes sense for an expense.
  await assert.rejects(
    correctMovement(user, advance.id, { targetActorId: null, targetAccountId: savings.id }),
    (e: Error) =>
      /movement_advance_is_expense|transfer_has_no_category/.test(e.message + (e as DomainError).code),
  )
})

test('a movement can be deleted unless a refund points at it', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const shop = await createActor(user, { name: 'Shop' })
  const friend = await createActor(user, { name: 'Friend' })

  const advance = await declareMovement(user, {
    happenedOn: '2026-03-01',
    amount: 60,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    expectedRefundFromActorId: friend.id,
    expectedRefundAmount: 60,
  })
  const refund = await declareMovement(user, {
    happenedOn: '2026-03-05',
    amount: 60,
    sourceActorId: friend.id,
    targetAccountId: checking.id,
    refundsMovementId: advance.id,
  })

  await assert.rejects(deleteMovement(user, advance.id), (e: DomainError) => e.code === 'refunded_movement')

  // Removing the refund first frees the advance.
  await deleteMovement(user, refund.id)
  await deleteMovement(user, advance.id)
  assert.equal((await listMovements(user)).length, 0)
})
