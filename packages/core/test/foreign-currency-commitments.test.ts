import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { today } from '../src/domain/period.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import {
  changeAmount,
  commitmentEvents,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  financingSchedule,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  reviseSchedule,
} from '../src/services/commitments.ts'
import { correctMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** A USD/EUR history whose latest close covers today, at a fixed rate. */
function stubHistory(rate = '0.85') {
  const calls: string[] = []
  return {
    calls,
    history: async (_source: string, reference: string) => {
      calls.push(reference)
      return [{ quotedOn: today(), price: rate }]
    },
  }
}

async function seedLedger() {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const saas = await createActor(user, { name: 'SaaS Inc' })
  return { user, checking, saas }
}

test('a USD subscription converts each confirmed occurrence at its day rate', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()

  const subscription = await createSubscription(
    user,
    {
      label: 'US SaaS',
      actorId: saas.id,
      accountId: checking.id,
      amount: 10,
      currency: 'usd',
      periodUnit: 'month',
      firstDueOn: today(),
    },
    history,
  )
  assert.equal(subscription.currency, 'USD')
  const [created] = await commitmentEvents(user, subscription.id)
  assert.equal(created?.currency, 'USD')

  const movement = (await confirmNextOccurrence(user, subscription.id, {}, history)).movement
  assert.equal(movement.amount, '8.50')
  assert.equal(movement.currency, 'EUR')
  assert.equal(movement.originalAmount, '10.00')
  assert.equal(movement.originalCurrency, 'USD')
})

test('the statement euros win at confirmation, and the new norm stays in USD', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()
  const subscription = await createSubscription(
    user,
    {
      label: 'US SaaS',
      actorId: saas.id,
      accountId: checking.id,
      amount: 10,
      currency: 'USD',
      periodUnit: 'month',
      firstDueOn: today(),
    },
    history,
  )

  const { movement } = await confirmNextOccurrence(
    user,
    subscription.id,
    { amount: 12, updateReference: true, eurAmount: 10.42 },
    history,
  )
  assert.equal(movement.amount, '10.42')
  assert.equal(movement.originalAmount, '12.00')

  // The reference amount moved in the billing currency, and the dated event says so.
  const [commitment] = await listCommitmentsWithProgress(user, true, history)
  assert.equal(commitment?.amount, '12.00')
  assert.equal(commitment?.currency, 'USD')
  const priceChange = (await commitmentEvents(user, subscription.id)).find((e) => e.type === 'price_changed')
  assert.equal(priceChange?.currency, 'USD')
})

test('forecast sums convert at the latest rate; the amount stays as billed', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory('0.9')
  await createSubscription(
    user,
    {
      label: 'US SaaS',
      actorId: saas.id,
      accountId: checking.id,
      amount: 10,
      currency: 'USD',
      periodUnit: 'month',
      firstDueOn: today(),
    },
    history,
  )

  const [commitment] = await listCommitmentsWithProgress(user, true, history)
  assert.equal(commitment?.amount, '10.00')
  assert.equal(commitment?.amountEur, '9.00')
  assert.equal(monthlyEquivalentEur(commitment!), 9)
})

test('a price change can move the billing currency, dated, without rewriting the past', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()
  const subscription = await createSubscription(
    user,
    {
      label: 'SaaS',
      actorId: saas.id,
      accountId: checking.id,
      amount: 9.99,
      periodUnit: 'month',
      firstDueOn: today(),
    },
    history,
  )

  const updated = await changeAmount(user, subscription.id, 12, undefined, {
    currency: 'USD',
    history,
  })
  assert.equal(updated.currency, 'USD')
  const events = await commitmentEvents(user, subscription.id)
  assert.equal(events.find((e) => e.type === 'created')?.currency, 'EUR')
  assert.equal(events.find((e) => e.type === 'price_changed')?.currency, 'USD')
})

test('a USD financing keeps its whole plan in USD and syncs both ways in it', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()
  const financing = await createFinancing(
    user,
    {
      label: 'US gear x2',
      actorId: saas.id,
      accountId: checking.id,
      installmentsTotal: 2,
      totalAmount: 100,
      currency: 'USD',
      firstDueOn: today(),
    },
    history,
  )
  assert.equal(financing.currency, 'USD')

  // Confirming settles the USD line and writes the frozen-EUR movement.
  const movement = (await confirmNextOccurrence(user, financing.id, {}, history)).movement
  assert.equal(movement.amount, '42.50')
  assert.equal(movement.originalAmount, '50.00')

  // Revising the settled line redeclares the paid side, in USD.
  const schedule = await financingSchedule(user, financing.id)
  const revised = await reviseSchedule(
    user,
    financing.id,
    schedule.map((line, index) => ({
      id: line.id,
      dueOn: line.dueOn,
      amount: index === 0 ? 60 : 50,
    })),
    history,
  )
  assert.equal(revised.totalAmount, '110.00')
  const [corrected] = await listMovements(user, { commitmentId: financing.id })
  assert.equal(corrected?.originalAmount, '60.00')
  assert.equal(corrected?.amount, '51.00')

  // Correcting the movement realigns the plan line from the paid side.
  await correctMovement(user, corrected!.id, { amount: 55, currency: 'USD' }, history)
  const [first] = await financingSchedule(user, financing.id)
  assert.equal(first?.amount, '55.00')

  // The plan's currency is for life.
  await assert.rejects(
    changeAmount(user, financing.id, 50, undefined, { currency: 'EUR', history }),
    (e: DomainError) => e.code === 'financing_keeps_currency',
  )
})

test('a plan is not realigned from a movement corrected into another currency', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()
  const financing = await createFinancing(user, {
    label: 'EUR gear x2',
    actorId: saas.id,
    accountId: checking.id,
    installmentsTotal: 2,
    totalAmount: 100,
    firstDueOn: today(),
  })
  await confirmNextOccurrence(user, financing.id)
  const [movement] = await listMovements(user, { commitmentId: financing.id })

  // A EUR plan, its settling movement redeclared in USD: 100 USD is not 100
  // EUR, so the plan line keeps its own truth instead of taking the units.
  await correctMovement(user, movement!.id, { amount: 100, currency: 'USD' }, history)
  const [first] = await financingSchedule(user, financing.id)
  assert.equal(first?.amount, '50.00')
})

test('revising only the date of a paid foreign installment keeps the statement euros', async () => {
  const { user, checking, saas } = await seedLedger()
  const { history } = stubHistory()
  const financing = await createFinancing(
    user,
    {
      label: 'US gear x2',
      actorId: saas.id,
      accountId: checking.id,
      installmentsTotal: 2,
      totalAmount: 100,
      currency: 'USD',
      firstDueOn: '2026-08-01',
    },
    history,
  )
  await confirmNextOccurrence(user, financing.id, { eurAmount: 43.21 }, history)

  const schedule = await financingSchedule(user, financing.id)
  await reviseSchedule(
    user,
    financing.id,
    schedule.map((line, index) => ({
      id: line.id,
      dueOn: index === 0 ? '2026-08-03' : line.dueOn,
      amount: Number(line.amount),
    })),
    history,
  )
  const [movement] = await listMovements(user, { commitmentId: financing.id })
  assert.equal(movement?.happenedOn, '2026-08-03')
  assert.equal(movement?.amount, '43.21')
  assert.equal(movement?.originalAmount, '50.00')
})
