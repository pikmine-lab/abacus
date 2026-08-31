import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import {
  confirmNextOccurrence,
  createInvestmentPlan,
  editCommitment,
  listCommitments,
  moveAccount,
  pendingOccurrences,
  skipNextOccurrence,
} from '../src/services/commitments.ts'
import { declareAsset, listOperations, positions, stopFollowing } from '../src/services/investments.ts'
import { listMovements } from '../src/services/movements.ts'
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

/** A plan due today, its source account funded, and the asset it buys. */
async function setup() {
  const user = await seedUser()
  const cash = await createAccount({
    userId: user,
    name: 'Espèces courtier',
    behavior: 'payment',
    openingBalance: 500,
    openedOn: '2026-01-01',
  })
  const securities = await createAccount({ userId: user, name: 'Compte-titres', behavior: 'investment' })
  const world = await declareAsset(user, { name: 'World', instrument: WORLD })
  const plan = await createInvestmentPlan(user, {
    label: 'Versement World',
    accountId: cash.id,
    targetAccountId: securities.id,
    assetId: world.id,
    amount: 100,
    periodUnit: 'month',
    firstDueOn: '2026-02-02',
  })
  return { user, cash, securities, world, plan }
}

const balanceOf = async (user: string, id: string) =>
  Number((await listAccounts(user)).find((a) => a.id === id)!.balance)

test('one confirmation writes the transfer and the purchase it funded', async () => {
  const { user, cash, securities, world, plan } = await setup()

  // The occurrence says where the money goes and what it buys: an interface
  // cannot ask for the quantity without knowing both.
  const [due] = await pendingOccurrences(user, '2026-02-02')
  assert.equal(due!.commitment.id, plan.id)
  assert.equal(due!.amount, 100)
  assert.deepEqual(due!.placement, { targetAccountId: securities.id, assetId: world.id })

  const { movement, operation } = await confirmNextOccurrence(user, plan.id, { quantity: 1.2345 })

  // Neutral by construction: both endpoints are the user's accounts, so it is
  // a transfer and never an expense.
  assert.equal(movement.kind, 'transfer')
  assert.equal(movement.sourceAccountId, cash.id)
  assert.equal(movement.targetAccountId, securities.id)
  assert.equal(movement.amount, '100.00')
  assert.equal(movement.commitmentId, plan.id)
  assert.equal(movement.categoryId, null)

  assert.equal(operation!.type, 'buy')
  assert.equal(operation!.assetId, world.id)
  assert.equal(operation!.quantity, '1.23450000')
  assert.equal(operation!.amount, '100.00')
  // The link is what keeps the two one event afterwards.
  assert.equal(operation!.movementId, movement.id)

  // The money left the source, and the target holds the shares rather than the
  // cash: the whole instalment was invested, so its cash is back to zero.
  assert.equal(await balanceOf(user, cash.id), 400)
  assert.equal(await balanceOf(user, securities.id), 0)
  const [position] = await positions(user, securities.id)
  assert.equal(position!.quantity, '1.23450000')
  assert.equal(position!.costBasis, '100.00')

  // And the plan advanced one period, like any commitment.
  const [after] = await listCommitments(user)
  assert.equal(after!.nextDueOn, '2026-03-02')
})

test('a placement is not confirmed without its quantity, and nothing is written', async () => {
  const { user, plan } = await setup()

  await assert.rejects(confirmNextOccurrence(user, plan.id), (e: DomainError) => e.code === 'needs_quantity')

  // Refused before the first write: no half-declaration, and the plan is still due.
  assert.equal((await listMovements(user)).length, 0)
  assert.equal((await listOperations(user)).length, 0)
  const [unchanged] = await listCommitments(user)
  assert.equal(unchanged!.nextDueOn, '2026-02-02')
})

test('what the broker did not invest stays in the account cash', async () => {
  const { user, cash, securities } = await setup()

  // 100 paid in, two shares at 48 bought: the broker buys no fraction, so 4
  // really sit in its cash. That is what makes the balance check work.
  const { movement, operation } = await confirmNextOccurrence(user, (await listCommitments(user))[0]!.id, {
    quantity: 2,
    investedAmount: 96,
  })
  assert.equal(movement.amount, '100.00')
  assert.equal(operation!.amount, '96.00')

  assert.equal(await balanceOf(user, cash.id), 400)
  assert.equal(await balanceOf(user, securities.id), 4)
})

test('an occurrence that will not happen is skipped, like a subscription', async () => {
  const { user, plan } = await setup()

  const skipped = await skipNextOccurrence(user, plan.id)
  assert.equal(skipped.nextDueOn, '2026-03-02')
  assert.equal((await listMovements(user)).length, 0)
  assert.equal((await listOperations(user)).length, 0)
})

test('an occurrence confirmed after a move leaves the account it really left', async () => {
  const { user, cash, plan } = await setup()
  const livret = await createAccount({
    userId: user,
    name: 'Livret',
    behavior: 'savings',
    openingBalance: 1000,
    openedOn: '2026-01-01',
  })

  // The plan moves to another source from March: February's occurrence, still
  // pending, belongs to the account in force on its own date.
  await moveAccount(user, plan.id, livret.id, '2026-03-01')
  const february = await confirmNextOccurrence(user, plan.id, { quantity: 1 })
  assert.equal(february.movement.sourceAccountId, cash.id)
  const march = await confirmNextOccurrence(user, plan.id, { quantity: 1 })
  assert.equal(march.movement.sourceAccountId, livret.id)
})

test('a plan can only feed an investment account, and never the one it leaves', async () => {
  const { user, cash, securities, world, plan } = await setup()

  await assert.rejects(
    createInvestmentPlan(user, {
      label: 'Vers un compte courant',
      accountId: securities.id,
      targetAccountId: cash.id,
      assetId: world.id,
      amount: 100,
      periodUnit: 'month',
      firstDueOn: '2026-02-02',
    }),
    (e: DomainError) => e.code === 'not_an_investment_account',
  )

  await assert.rejects(
    createInvestmentPlan(user, {
      label: 'Vers lui-même',
      accountId: securities.id,
      targetAccountId: securities.id,
      assetId: world.id,
      amount: 100,
      periodUnit: 'month',
      firstDueOn: '2026-02-02',
    }),
    (e: DomainError) => e.code === 'same_account',
  )

  // The same check holds for the dated move of the source account.
  await assert.rejects(
    moveAccount(user, plan.id, securities.id),
    (e: DomainError) => e.code === 'same_account',
  )
})

test('a placement pays nobody, so it carries no actor and no category', async () => {
  const { user, plan } = await setup()

  assert.equal(plan.actorId, null)
  assert.equal(plan.categoryId, null)
  await assert.rejects(
    editCommitment(user, plan.id, { categoryId: 'not-a-category' }),
    (e: DomainError) => e.code === 'placement_has_no_actor',
  )
})

test('an asset a plan buys cannot be forgotten', async () => {
  const { user, world } = await setup()

  await assert.rejects(stopFollowing(user, world.id), (e: DomainError) => e.code === 'asset_has_plans')
})
