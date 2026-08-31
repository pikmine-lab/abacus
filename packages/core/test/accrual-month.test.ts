import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { recordBalanceCheck } from '../src/services/balanceChecks.ts'
import { confirmNextOccurrence, createSubscription } from '../src/services/commitments.ts'
import { correctMovement, declareMovement, listMovements } from '../src/services/movements.ts'
import { balanceSeries, flowTotals, monthlyFlows, spendingBreakdown } from '../src/services/reports.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function fixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const landlord = await createActor(user, { name: 'Landlord' })
  return { account, employer, landlord }
}

test('an attached movement counts in its month for analysis and in its day for balances', async () => {
  const user = await seedUser()
  const { account, employer } = await fixture(user)

  // August's salary, paid on the 2nd of September.
  await declareMovement(user, {
    happenedOn: '2026-09-02',
    amount: 2400,
    sourceActorId: employer.id,
    targetAccountId: account.id,
    accrualMonth: '2026-08',
  })

  const augustCash = await flowTotals(user, '2026-08-01', '2026-08-31')
  const augustAccrual = await flowTotals(user, '2026-08-01', '2026-08-31', 'accrual')
  assert.equal(augustCash.income, '0.00')
  assert.equal(augustAccrual.income, '2400.00')

  const septemberCash = await flowTotals(user, '2026-09-01', '2026-09-30')
  const septemberAccrual = await flowTotals(user, '2026-09-01', '2026-09-30', 'accrual')
  assert.equal(septemberCash.income, '2400.00')
  assert.equal(septemberAccrual.income, '0.00')

  // The money is still on the account the day it arrived, and not before: no
  // reading of the analysis moves a euro.
  const [firstOfSeptember] = await balanceSeries(user, '2026-09-01', '2026-09-01')
  assert.equal(firstOfSeptember!.balance, '0.00')
  const check = await recordBalanceCheck(user, account.id, 0, '2026-09-01')
  assert.equal(check.gap, 0)
})

test('confirming an occurrence attaches it to the month it was due', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)
  const rent = await createSubscription(user, {
    label: 'Rent',
    actorId: landlord.id,
    accountId: account.id,
    amount: 900,
    periodUnit: 'month',
    firstDueOn: '2026-09-01',
  })

  // September's rent, debited two days early: nobody types the month.
  const movement = (await confirmNextOccurrence(user, rent.id, { happenedOn: '2026-08-30' })).movement
  assert.equal(movement.happenedOn, '2026-08-30')
  assert.equal(movement.accrualMonth, '2026-09-01')

  const august = await spendingBreakdown(user, '2026-08-01', '2026-08-31', 'actor', 'expense', 'accrual')
  assert.equal(august.length, 0)
  const september = await spendingBreakdown(user, '2026-09-01', '2026-09-30', 'actor', 'expense', 'accrual')
  assert.equal(september[0]?.gross, '900.00')
})

test('an occurrence paid in the month it was due carries no attachment', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)
  const rent = await createSubscription(user, {
    label: 'Rent',
    actorId: landlord.id,
    accountId: account.id,
    amount: 900,
    periodUnit: 'month',
    firstDueOn: '2026-09-01',
  })

  // Three days late, same month: the default is never materialised, so the
  // movement keeps following its own date.
  const movement = (await confirmNextOccurrence(user, rent.id, { happenedOn: '2026-09-04' })).movement
  assert.equal(movement.accrualMonth, null)
  assert.equal(movement.countedInMonth, '2026-09-01')
})

test('correcting a date moves an unattached movement and leaves an attached one', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)

  const plain = await declareMovement(user, {
    happenedOn: '2026-08-30',
    amount: 40,
    sourceAccountId: account.id,
    targetActorId: landlord.id,
  })
  const attached = await declareMovement(user, {
    happenedOn: '2026-08-30',
    amount: 900,
    sourceAccountId: account.id,
    targetActorId: landlord.id,
    accrualMonth: '2026-09',
  })

  const movedPlain = await correctMovement(user, plain.id, { happenedOn: '2026-09-03' })
  assert.equal(movedPlain.accrualMonth, null)
  assert.equal(movedPlain.countedInMonth, '2026-09-01')

  const movedAttached = await correctMovement(user, attached.id, { happenedOn: '2026-09-03' })
  assert.equal(movedAttached.accrualMonth, '2026-09-01')

  // And correcting it back to August leaves September in place: what was
  // stated on purpose survives a date fix.
  const backInAugust = await correctMovement(user, attached.id, { happenedOn: '2026-08-30' })
  assert.equal(backInAugust.accrualMonth, '2026-09-01')
  assert.equal(backInAugust.countedInMonth, '2026-09-01')
})

test('an attachment is dropped by passing null, and the movement follows its date again', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)
  const movement = await declareMovement(user, {
    happenedOn: '2026-08-30',
    amount: 900,
    sourceAccountId: account.id,
    targetActorId: landlord.id,
    accrualMonth: '2026-09',
  })

  const detached = await correctMovement(user, movement.id, { accrualMonth: null })
  assert.equal(detached.accrualMonth, null)
  assert.equal(detached.countedInMonth, '2026-08-01')
})

test('a month ahead is accepted, an internal transfer is not attachable', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)
  const savings = await createAccount({ userId: user, name: 'Savings', behavior: 'savings' })

  // Tickets bought in August for a trip in December.
  const ahead = await declareMovement(user, {
    happenedOn: '2026-08-12',
    amount: 210,
    sourceAccountId: account.id,
    targetActorId: landlord.id,
    accrualMonth: '2026-12',
  })
  assert.equal(ahead.accrualMonth, '2026-12-01')

  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-08-12',
      amount: 100,
      sourceAccountId: account.id,
      targetAccountId: savings.id,
      accrualMonth: '2026-09',
    }),
    (e: DomainError) => e.code === 'transfer_has_no_accrual',
  )
  await assert.rejects(
    declareMovement(user, {
      happenedOn: '2026-08-12',
      amount: 100,
      sourceAccountId: account.id,
      targetActorId: landlord.id,
      accrualMonth: 'décembre',
    }),
    (e: DomainError) => e.code === 'bad_month',
  )
})

test('the accrual reading rounds a rolling window out to whole months', async () => {
  const user = await seedUser()
  const { account, landlord } = await fixture(user)
  await declareMovement(user, {
    happenedOn: '2026-07-20',
    amount: 50,
    sourceAccountId: account.id,
    targetActorId: landlord.id,
  })

  // A window opening on the 25th holds nothing on the 20th by day, and holds
  // the whole month of July by attachment: a month is the finest attachment
  // there is, so cutting it in the middle would drop it without saying so.
  const byDay = await flowTotals(user, '2026-07-25', '2026-09-12')
  assert.equal(byDay.expenseGross, '0.00')
  const byMonth = await flowTotals(user, '2026-07-25', '2026-09-12', 'accrual')
  assert.equal(byMonth.expenseGross, '50.00')
})

test('a month-by-month series and a movement list read the same attachment', async () => {
  const user = await seedUser()
  const { account, employer } = await fixture(user)
  await declareMovement(user, {
    happenedOn: '2026-09-02',
    amount: 2400,
    sourceActorId: employer.id,
    targetAccountId: account.id,
    accrualMonth: '2026-08',
  })

  const cash = await monthlyFlows(user, '2026-08-01', '2026-09-30')
  assert.deepEqual(
    cash.map((m) => [m.month, m.income]),
    [
      ['2026-08-01', '0.00'],
      ['2026-09-01', '2400.00'],
    ],
  )
  const accrual = await monthlyFlows(user, '2026-08-01', '2026-09-30', 'accrual')
  assert.deepEqual(
    accrual.map((m) => [m.month, m.income]),
    [
      ['2026-08-01', '2400.00'],
      ['2026-09-01', '0.00'],
    ],
  )

  const inAugust = await listMovements(user, { from: '2026-08-01', to: '2026-08-31', reading: 'accrual' })
  assert.equal(inAugust.length, 1)
  const inAugustByDay = await listMovements(user, { from: '2026-08-01', to: '2026-08-31' })
  assert.equal(inAugustByDay.length, 0)
})
