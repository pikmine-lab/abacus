import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { addPeriod } from '../src/domain/period.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import {
  cancelCommitment,
  changeAmount,
  commitmentEvents,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  editCommitment,
  financingSchedule,
  listCommitmentsWithProgress,
  pendingOccurrences,
  reviseSchedule,
  skipNextOccurrence,
} from '../src/services/commitments.ts'
import { correctMovement, deleteMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('adds periods with end-of-month clamping', () => {
  assert.equal(addPeriod('2026-01-31', 'month', 1), '2026-02-28')
  assert.equal(addPeriod('2026-01-15', 'month', 1), '2026-02-15')
  assert.equal(addPeriod('2026-11-30', 'month', 3), '2027-02-28')
  assert.equal(addPeriod('2026-01-01', 'week', 2), '2026-01-15')
  assert.equal(addPeriod('2026-03-10', 'year', 1), '2027-03-10')
})

async function subscriptionFixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const actor = await createActor(user, { name: 'Netflix' })
  const subscription = await createSubscription(user, {
    label: 'Netflix',
    actorId: actor.id,
    accountId: account.id,
    amount: 13.49,
    periodUnit: 'month',
    firstDueOn: '2026-05-01',
  })
  return { account, actor, subscription }
}

test('confirming an occurrence creates the movement and advances the commitment', async () => {
  const user = await seedUser()
  const { subscription, account, actor } = await subscriptionFixture(user)

  const movement = await confirmNextOccurrence(user, subscription.id)

  assert.equal(movement.kind, 'expense')
  assert.equal(movement.amount, '13.49')
  assert.equal(movement.sourceAccountId, account.id)
  assert.equal(movement.targetActorId, actor.id)
  assert.equal(movement.commitmentId, subscription.id)

  const pending = await pendingOccurrences(user, '2026-06-30')
  assert.deepEqual(
    pending.map((p) => p.dueOn),
    ['2026-06-01'],
  )
})

test('expands several late occurrences and skips advance without a movement', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const pending = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    pending.map((p) => p.dueOn),
    ['2026-05-01', '2026-06-01', '2026-07-01'],
  )

  await skipNextOccurrence(user, subscription.id)
  const after = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    after.map((p) => p.dueOn),
    ['2026-06-01', '2026-07-01'],
  )
})

test('a price change updates the amount and leaves a dated event', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const updated = await changeAmount(user, subscription.id, 15.99, '2026-06-01')
  assert.equal(updated.amount, '15.99')

  // Events are ordered by occurrence date; the price change is backdated here,
  // so it comes before the creation event (dated today). Assert content, not order.
  const events = await commitmentEvents(user, subscription.id)
  const byType = new Map(events.map((e) => [e.type, e.amount]))
  assert.equal(byType.get('created'), '13.49')
  assert.equal(byType.get('price_changed'), '15.99')
  assert.equal(events.length, 2)
})

test('a cancelled subscription stops generating occurrences', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  await cancelCommitment(user, subscription.id, '2026-05-15')
  assert.deepEqual(await pendingOccurrences(user, '2026-12-31'), [])
  await assert.rejects(
    confirmNextOccurrence(user, subscription.id),
    (e: DomainError) => e.code === 'cancelled',
  )
})

test('a financing stops at its last installment and derives its total', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })
  const financing = await createFinancing(user, {
    label: 'Sofa x4',
    actorId: store.id,
    accountId: account.id,
    totalAmount: 1000,
    installmentsTotal: 4,
    firstDueOn: '2026-01-15',
  })
  assert.equal(financing.totalAmount, '1000.00')

  // Even far in the future, only 4 occurrences ever exist.
  const pending = await pendingOccurrences(user, '2027-12-31')
  assert.equal(pending.filter((p) => p.commitment.id === financing.id).length, 4)

  for (let i = 0; i < 4; i++) await confirmNextOccurrence(user, financing.id)
  await assert.rejects(
    confirmNextOccurrence(user, financing.id),
    (e: DomainError) => e.code === 'financing_settled',
  )
  assert.deepEqual(await pendingOccurrences(user, '2027-12-31'), [])
})

test('an incoming commitment (salary) confirms into an income', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const employer = await createActor(user, { name: 'Employer' })
  const salary = await createSubscription(user, {
    label: 'Salary',
    actorId: employer.id,
    accountId: account.id,
    direction: 'incoming',
    amount: 2500,
    periodUnit: 'month',
    firstDueOn: '2026-05-28',
  })

  const movement = await confirmNextOccurrence(user, salary.id)
  assert.equal(movement.kind, 'income')
  assert.equal(movement.sourceActorId, employer.id)
  assert.equal(movement.targetAccountId, account.id)
})

test('the default schedule spreads the rounding onto the last installment', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })

  // 1000 in 3 is not divisible: the plan must still add up to 1000 exactly.
  const financing = await createFinancing(user, {
    label: 'Vélo en 3x',
    actorId: store.id,
    accountId: account.id,
    totalAmount: 1000,
    installmentsTotal: 3,
    firstDueOn: '2026-03-10',
  })
  const schedule = await financingSchedule(user, financing.id)
  assert.deepEqual(
    schedule.map((i) => [i.dueOn, i.amount]),
    [
      ['2026-03-10', '333.33'],
      ['2026-04-10', '333.33'],
      ['2026-05-10', '333.34'],
    ],
  )
  const sum = schedule.reduce((total, i) => total + Math.round(Number(i.amount) * 100), 0)
  assert.equal(sum, 100000)
})

test('an uneven schedule is stored as given and drives the occurrences', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })

  // A real plan: a bigger deposit, then two irregular dates.
  const financing = await createFinancing(user, {
    label: 'Cuisine',
    actorId: store.id,
    accountId: account.id,
    totalAmount: 3000,
    installmentsTotal: 3,
    firstDueOn: '2026-02-01',
    installments: [
      { dueOn: '2026-02-01', amount: 1500 },
      { dueOn: '2026-03-05', amount: 900 },
      { dueOn: '2026-05-20', amount: 600 },
    ],
  })

  // Each occurrence is expected for its own amount, not for an average.
  const pending = await pendingOccurrences(user, '2026-12-31')
  assert.deepEqual(
    pending.filter((p) => p.commitment.id === financing.id).map((p) => [p.dueOn, p.amount]),
    [
      ['2026-02-01', 1500],
      ['2026-03-05', 900],
      ['2026-05-20', 600],
    ],
  )

  // Confirming the deposit leaves exactly what the plan still owes.
  const movement = await confirmNextOccurrence(user, financing.id)
  assert.equal(movement.amount, '1500.00')
  assert.equal(movement.happenedOn, '2026-02-01')
  const [tracked] = (await listCommitmentsWithProgress(user)).filter((c) => c.id === financing.id)
  assert.equal(tracked!.progress!.paidInstallments, 1)
  assert.equal(tracked!.progress!.remainingDue, 1500)
  assert.equal(tracked!.progress!.nextAmount, 900)
  assert.equal(tracked!.nextDueOn, '2026-03-05')

  // A written installment is owed: it cannot be skipped like a free month.
  await assert.rejects(
    skipNextOccurrence(user, financing.id),
    (e: DomainError) => e.code === 'cannot_skip_financing',
  )
})

test('a schedule that does not add up to the total is refused', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })

  await assert.rejects(
    createFinancing(user, {
      label: 'Faux plan',
      actorId: store.id,
      accountId: account.id,
      totalAmount: 1000,
      installmentsTotal: 2,
      firstDueOn: '2026-01-10',
      installments: [
        { dueOn: '2026-01-10', amount: 400 },
        { dueOn: '2026-02-10', amount: 400 },
      ],
    }),
    (e: DomainError) => e.code === 'schedule_sum_mismatch',
  )

  await assert.rejects(
    createFinancing(user, {
      label: 'Mauvais compte',
      actorId: store.id,
      accountId: account.id,
      totalAmount: 800,
      installmentsTotal: 3,
      firstDueOn: '2026-01-10',
      installments: [
        { dueOn: '2026-01-10', amount: 400 },
        { dueOn: '2026-02-10', amount: 400 },
      ],
    }),
    (e: DomainError) => e.code === 'schedule_length_mismatch',
  )
})

test('deleting a confirmed installment puts it back on the plan', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })
  const financing = await createFinancing(user, {
    label: 'Écran en 2x',
    actorId: store.id,
    accountId: account.id,
    totalAmount: 600,
    installmentsTotal: 2,
    firstDueOn: '2026-04-10',
  })

  const paid = await confirmNextOccurrence(user, financing.id)
  let tracked = (await listCommitmentsWithProgress(user)).find((c) => c.id === financing.id)!
  assert.equal(tracked.progress!.paidInstallments, 1)
  assert.equal(tracked.nextDueOn, '2026-05-10')

  // Confirmed by mistake: removing the movement owes the installment again and
  // moves the plan back onto it, instead of skipping it silently.
  await deleteMovement(user, paid.id)
  tracked = (await listCommitmentsWithProgress(user)).find((c) => c.id === financing.id)!
  assert.equal(tracked.progress!.paidInstallments, 0)
  assert.equal(tracked.progress!.remainingDue, 600)
  assert.equal(tracked.nextDueOn, '2026-04-10')
  assert.equal((await pendingOccurrences(user, '2026-12-31')).length, 2)
})

async function financingFixture(user: string) {
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const store = await createActor(user, { name: 'Store' })
  const financing = await createFinancing(user, {
    label: 'Cuisine',
    actorId: store.id,
    accountId: account.id,
    totalAmount: 3000,
    installmentsTotal: 3,
    firstDueOn: '2026-02-01',
    installments: [
      { dueOn: '2026-02-01', amount: 1500 },
      { dueOn: '2026-03-05', amount: 900 },
      { dueOn: '2026-04-05', amount: 600 },
    ],
  })
  return { account, store, financing }
}

async function trackedFinancing(user: string, id: string) {
  return (await listCommitmentsWithProgress(user)).find((c) => c.id === id)!
}

test('revising a schedule moves a date, changes an amount, and the total follows', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  const schedule = await financingSchedule(user, financing.id)

  // The last installment is pushed back a month and renegotiated down.
  await reviseSchedule(user, financing.id, [
    { id: schedule[0]!.id, dueOn: schedule[0]!.dueOn, amount: 1500 },
    { id: schedule[1]!.id, dueOn: schedule[1]!.dueOn, amount: 900 },
    { id: schedule[2]!.id, dueOn: '2026-05-05', amount: 400 },
  ])

  const revised = await financingSchedule(user, financing.id)
  assert.deepEqual(
    revised.map((i) => [i.position, i.dueOn, i.amount]),
    [
      [1, '2026-02-01', '1500.00'],
      [2, '2026-03-05', '900.00'],
      [3, '2026-05-05', '400.00'],
    ],
  )

  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.totalAmount, '2800.00')
  assert.equal(tracked.progress!.remainingDue, 2800)
  assert.equal(tracked.nextDueOn, '2026-02-01')
})

test('revising adds and drops installments, and renumbers what is left', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  const schedule = await financingSchedule(user, financing.id)

  // The second installment is dropped and a new one is added at the end.
  await reviseSchedule(user, financing.id, [
    { id: schedule[0]!.id, dueOn: schedule[0]!.dueOn, amount: 1500 },
    { id: schedule[2]!.id, dueOn: schedule[2]!.dueOn, amount: 600 },
    { dueOn: '2026-05-05', amount: 250 },
  ])

  const revised = await financingSchedule(user, financing.id)
  assert.deepEqual(
    revised.map((i) => [i.position, i.dueOn, i.amount]),
    [
      [1, '2026-02-01', '1500.00'],
      [2, '2026-04-05', '600.00'],
      [3, '2026-05-05', '250.00'],
    ],
  )

  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.installmentsTotal, 3)
  assert.equal(tracked.totalAmount, '2350.00')
  assert.equal(tracked.progress!.remainingDue, 2350)
  assert.equal((await pendingOccurrences(user, '2026-12-31')).length, 3)
})

test('revising a settled installment corrects the movement that paid it', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  const paid = await confirmNextOccurrence(user, financing.id)
  const schedule = await financingSchedule(user, financing.id)

  // The deposit really was 1 400: the plan and the movement say so together.
  await reviseSchedule(
    user,
    financing.id,
    schedule.map((i) => ({ id: i.id, dueOn: i.dueOn, amount: i.position === 1 ? 1400 : Number(i.amount) })),
  )

  const movements = await listMovements(user, { commitmentId: financing.id })
  assert.equal(movements[0]!.id, paid.id)
  assert.equal(movements[0]!.amount, '1400.00')

  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.progress!.paidTotal, '1400.00')
  assert.equal(tracked.totalAmount, '2900.00')
  assert.equal(tracked.progress!.remainingDue, 1500)
})

test('dropping a settled installment deletes the movement that paid it', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  await confirmNextOccurrence(user, financing.id)
  const schedule = await financingSchedule(user, financing.id)

  // That first installment was never owed: the line and its movement go together.
  await reviseSchedule(
    user,
    financing.id,
    schedule
      .filter((i) => i.position > 1)
      .map((i) => ({ id: i.id, dueOn: i.dueOn, amount: Number(i.amount) })),
  )

  assert.equal((await listMovements(user, { commitmentId: financing.id })).length, 0)
  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.progress!.paidInstallments, 0)
  assert.equal(tracked.totalAmount, '1500.00')
  assert.equal(tracked.progress!.remainingDue, 1500)
  assert.equal(tracked.nextDueOn, '2026-03-05')
})

test('correcting the movement of an installment realigns the plan', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  const paid = await confirmNextOccurrence(user, financing.id)

  // Typed 1 500 instead of 1 450: correcting the movement corrects the plan.
  await correctMovement(user, paid.id, { amount: 1450 })

  const schedule = await financingSchedule(user, financing.id)
  assert.equal(schedule[0]!.amount, '1450.00')
  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.progress!.paidTotal, '1450.00')
  assert.equal(tracked.totalAmount, '2950.00')
})

test('a schedule revision refuses what would leave no plan at all', async () => {
  const user = await seedUser()
  const { financing, account, store } = await financingFixture(user)
  const subscription = await createSubscription(user, {
    label: 'Netflix',
    actorId: store.id,
    accountId: account.id,
    amount: 13.49,
    periodUnit: 'month',
    firstDueOn: '2026-05-01',
  })

  await assert.rejects(
    reviseSchedule(user, financing.id, []),
    (e: DomainError) => e.code === 'schedule_empty',
  )
  await assert.rejects(
    reviseSchedule(user, subscription.id, [{ dueOn: '2026-06-01', amount: 10 }]),
    (e: DomainError) => e.code === 'not_a_financing',
  )
})

test('a settled installment and its movement keep the same date, edited from either side', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)
  const paid = await confirmNextOccurrence(user, financing.id)

  // Debited two days late: the settled line says the payment, not the intent.
  await correctMovement(user, paid.id, { happenedOn: '2026-02-03' })
  let schedule = await financingSchedule(user, financing.id)
  assert.equal(schedule[0]!.dueOn, '2026-02-03')

  // And back from the schedule side: the movement follows.
  await reviseSchedule(
    user,
    financing.id,
    schedule.map((i) => ({
      id: i.id,
      dueOn: i.position === 1 ? '2026-02-05' : i.dueOn,
      amount: Number(i.amount),
    })),
  )
  schedule = await financingSchedule(user, financing.id)
  assert.equal(schedule[0]!.dueOn, '2026-02-05')
  const movements = await listMovements(user, { commitmentId: financing.id })
  assert.equal(movements[0]!.happenedOn, '2026-02-05')

  // The plan's cursor still points at the first unpaid installment.
  const tracked = await trackedFinancing(user, financing.id)
  assert.equal(tracked.nextDueOn, '2026-03-05')
})

test('editing a commitment corrects what it says, not the movements it produced', async () => {
  const user = await seedUser()
  const { subscription, account } = await subscriptionFixture(user)
  const other = await createAccount({ userId: user, name: 'Second', behavior: 'payment' })
  const provider = await createActor(user, { name: 'Netflix SAS' })
  const movement = await confirmNextOccurrence(user, subscription.id)

  const edited = await editCommitment(user, subscription.id, {
    label: 'Netflix Standard',
    actorId: provider.id,
    accountId: other.id,
    periodCount: 2,
  })
  assert.equal(edited.label, 'Netflix Standard')
  assert.equal(edited.actorId, provider.id)
  assert.equal(edited.accountId, other.id)
  assert.equal(edited.periodCount, 2)
  // The amount has its own dated history: an edit never touches it.
  assert.equal(edited.amount, '13.49')

  // What already happened, happened on the account it happened on.
  const [past] = await listMovements(user, { commitmentId: subscription.id })
  assert.equal(past!.id, movement.id)
  assert.equal(past!.sourceAccountId, account.id)

  // The next occurrence, though, follows the correction.
  const confirmed = await confirmNextOccurrence(user, subscription.id)
  assert.equal(confirmed.sourceAccountId, other.id)
  assert.equal(confirmed.targetActorId, provider.id)
})

test('editing a commitment refuses a reference that is not the user’s', async () => {
  const user = await seedUser()
  const other = await seedUser('user-2')
  const { subscription } = await subscriptionFixture(user)
  const theirAccount = await createAccount({ userId: other, name: 'Theirs', behavior: 'payment' })

  await assert.rejects(
    editCommitment(user, subscription.id, { accountId: theirAccount.id }),
    (e: DomainError) => e.code === 'account_not_found',
  )
  await assert.rejects(
    editCommitment(user, subscription.id, { accountId: '00000000-0000-0000-0000-000000000000' }),
    (e: DomainError) => e.code === 'account_not_found',
  )
})

test('a financing takes no lock-in date: it ends at its last installment', async () => {
  const user = await seedUser()
  const { financing } = await financingFixture(user)

  await assert.rejects(
    editCommitment(user, financing.id, { engagedUntil: '2027-01-01' }),
    (e: DomainError) => e.code === 'financing_has_no_lock_in',
  )
  // Its label and creditor stay correctable, like any other commitment.
  const edited = await editCommitment(user, financing.id, { label: 'Cuisine équipée' })
  assert.equal(edited.label, 'Cuisine équipée')
  assert.equal((await financingSchedule(user, financing.id)).length, 3)
})
