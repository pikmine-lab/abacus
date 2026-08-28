import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount, editAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { recordBalanceCheck } from '../src/services/balanceChecks.ts'
import {
  declareAsset,
  portfolio,
  recordOperations,
  setManualPrice,
  valuationHistory,
} from '../src/services/investments.ts'
import { declareMovement } from '../src/services/movements.ts'
import { balanceSeries, firstDeclaredDay, flowTotals } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('an account taken over starts at what it already held, and no flow says so', async () => {
  const user = await seedUser()
  const account = await createAccount({
    userId: user,
    name: 'Checking',
    behavior: 'payment',
    openingBalance: 3000,
    openedOn: '2026-01-01',
  })
  const shop = await createActor(user, { name: 'Shop' })
  await declareMovement(user, {
    happenedOn: '2026-02-10',
    amount: 200,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })

  const [listed] = await listAccounts(user)
  assert.equal(listed!.balance, '2800.00')

  // The reason the whole thing exists: the bank says 2800 and the ledger
  // agrees, where without an opening it would have reported 3000 missing.
  const check = await recordBalanceCheck(user, account.id, 2800, '2026-02-28')
  assert.equal(check.gap, 0)

  // The opening is not a flow: the month it lands in shows the spending alone.
  const totals = await flowTotals(user, '2026-01-01', '2026-02-28')
  assert.equal(totals.income, '0.00')
  assert.equal(totals.expenseGross, '200.00')
})

test('the opening holds from its day, in the series as in a check', async () => {
  const user = await seedUser()
  const account = await createAccount({
    userId: user,
    name: 'Livret',
    behavior: 'savings',
    openingBalance: 500,
    openedOn: '2026-03-10',
  })

  // A check dated before the account opened compares against nothing.
  const before = await recordBalanceCheck(user, account.id, 0, '2026-03-09')
  assert.equal(before.check.computedBalance, '0.00')

  const series = await balanceSeries(user, '2026-03-09', '2026-03-11')
  assert.deepEqual(
    series.map((p) => [p.day, p.balance]),
    [
      ['2026-03-09', '0.00'],
      ['2026-03-10', '500.00'],
      ['2026-03-11', '500.00'],
    ],
  )

  // And the window of the "everything" preset reaches back to that day, so the
  // plateau is drawn instead of starting at the first movement.
  assert.equal(await firstDeclaredDay(user), '2026-03-10')
})

test('an opening is corrected like anything else, and needs the day it holds from', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  assert.equal((await listAccounts(user))[0]!.balance, '0.00')

  await assert.rejects(
    editAccount(user, account.id, { openingBalance: 1200 }),
    (e: DomainError) => e.code === 'opening_needs_its_day',
  )
  await assert.rejects(
    createAccount({
      userId: user,
      name: 'Other',
      behavior: 'payment',
      openingBalance: 1200,
    }),
    (e: DomainError) => e.code === 'opening_needs_its_day',
  )

  // A statement read wrong is the likeliest correction: 1200 was 1250.
  await editAccount(user, account.id, { openingBalance: 1200, openedOn: '2026-01-05' })
  await editAccount(user, account.id, { openingBalance: 1250 })
  const [corrected] = await listAccounts(user)
  assert.equal(corrected!.openingBalance, '1250.00')
  assert.equal(corrected!.balance, '1250.00')

  // Overdrawn is a legitimate takeover, and clearing the opening is too.
  await editAccount(user, account.id, { openingBalance: -80 })
  assert.equal((await listAccounts(user))[0]!.balance, '-80.00')
  await editAccount(user, account.id, { openingBalance: 0 })
  assert.equal((await listAccounts(user))[0]!.balance, '0.00')
})

test('on an investment account the opening is cash put in, never performance', async () => {
  const user = await seedUser()
  const pea = await createAccount({
    userId: user,
    name: 'PEA',
    behavior: 'investment',
    openingBalance: 5000,
    openedOn: '2026-01-02',
  })
  const shares = await declareAsset(user, { name: 'Parts non cotées', nature: 'equity' })
  // A position already held is declared by its purchase, which spends the cash.
  await recordOperations(user, [
    {
      accountId: pea.id,
      assetId: shares.id,
      type: 'buy',
      operatedOn: '2026-01-03',
      quantity: 10,
      amount: 2000,
    },
  ])
  await setManualPrice(user, shares.id, 200, '2026-01-03')

  const [held] = await portfolio(user)
  assert.equal(held!.cash, '3000.00')
  assert.equal(held!.netContributions, '5000.00')
  // Cash 3000 plus 2000 of holdings, against 5000 put in: nothing made yet,
  // where an opening left out of the contributions would claim 5000 of gain.
  assert.equal(held!.value, '5000.00')
  assert.equal(held!.totalReturn, '0.00')

  // The curve says the same, both lines starting at the takeover.
  const history = await valuationHistory(user, '2026-01-03', '2026-01-03')
  assert.equal(history!.end.contributions, 5000)
  assert.equal(history!.end.performance, 0)
})
