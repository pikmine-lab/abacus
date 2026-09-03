import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { addPeriod, today } from '../src/domain/period.ts'
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
  moveAccount,
  pendingOccurrences,
  reviseSchedule,
  setJudgment,
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

  const movement = (await confirmNextOccurrence(user, subscription.id)).movement

  assert.equal(movement.kind, 'expense')
  assert.equal(movement.amount, '13.49')
  assert.equal(movement.sourceAccountId, account.id)
  assert.equal(movement.targetActorId, actor.id)
  assert.equal(movement.commitmentId, subscription.id)

  // June is owed; July is the coming month, listed ahead so an early debit
  // has somewhere to go.
  const pending = await pendingOccurrences(user, '2026-06-30')
  assert.deepEqual(
    pending.map((p) => [p.dueOn, p.ahead]),
    [
      ['2026-06-01', false],
      ['2026-07-01', true],
    ],
  )
})

test('expands several late occurrences and skips advance without a movement', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const pending = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    pending.map((p) => p.dueOn),
    ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'],
  )

  await skipNextOccurrence(user, subscription.id)
  const after = await pendingOccurrences(user, '2026-07-15')
  assert.deepEqual(
    after.map((p) => p.dueOn),
    ['2026-06-01', '2026-07-01', '2026-08-01'],
  )
})

test('the coming month is listed ahead, and confirmed early it counts in its own month', async () => {
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
    firstDueOn: '2026-10-05',
  })

  // Late September: October is the coming month, November is not yet.
  assert.deepEqual(
    (await pendingOccurrences(user, '2026-09-20')).map((p) => [p.dueOn, p.ahead]),
    [['2026-10-05', true]],
  )

  // Received on the 28th: the movement is dated that day and is about October.
  const movement = (await confirmNextOccurrence(user, salary.id, { happenedOn: '2026-09-28' })).movement
  assert.equal(movement.happenedOn, '2026-09-28')
  assert.equal(movement.accrualMonth, '2026-10-01')

  // November is two periods away from September, so nothing is left to list
  // there; it becomes the coming one once October opens.
  assert.deepEqual(await pendingOccurrences(user, '2026-09-20'), [])
  assert.deepEqual(
    (await pendingOccurrences(user, '2026-10-01')).map((p) => [p.dueOn, p.ahead]),
    [['2026-11-05', true]],
  )
})

test('the coming period is the next month of a yearly rhythm and the next week of a weekly one', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const provider = await createActor(user, { name: 'Provider' })
  const base = { actorId: provider.id, accountId: account.id }
  await createSubscription(user, {
    ...base,
    label: 'Domain',
    amount: 12,
    periodUnit: 'year',
    firstDueOn: '2027-03-10',
  })
  await createSubscription(user, {
    ...base,
    label: 'Cleaning',
    amount: 40,
    periodUnit: 'week',
    firstDueOn: '2026-09-18',
  })
  const listed = async (label: string, on: string) =>
    (await pendingOccurrences(user, on)).filter((p) => p.commitment.label === label).map((p) => p.dueOn)

  // A yearly occurrence is about its month: it shows from the month before.
  assert.deepEqual(await listed('Domain', '2027-01-31'), [])
  assert.deepEqual(await listed('Domain', '2027-02-01'), ['2027-03-10'])
  // A weekly one has no month: the coming week, not the four of a month.
  assert.deepEqual(await listed('Cleaning', '2026-09-10'), [])
  assert.deepEqual(await listed('Cleaning', '2026-09-11'), ['2026-09-18'])
  assert.deepEqual(await listed('Cleaning', '2026-09-16'), ['2026-09-18'])
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

test('judging a subscription keeps the note when none is given', async () => {
  const user = await seedUser()
  const { subscription } = await subscriptionFixture(user)

  const noted = await setJudgment(user, subscription.id, 'reducible', 'Passer au palier avec pub ?')
  assert.equal(noted.judgment, 'reducible')
  assert.equal(noted.judgmentNote, 'Passer au palier avec pub ?')

  // What the web sends: a judgment alone. The note it never offered stays.
  const rejudged = await setJudgment(user, subscription.id, 'to_cancel')
  assert.equal(rejudged.judgment, 'to_cancel')
  assert.equal(rejudged.judgmentNote, 'Passer au palier avec pub ?')

  const types = (await commitmentEvents(user, subscription.id)).map((e) => e.type)
  assert.equal(types.filter((t) => t === 'judgment_changed').length, 2)
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

  const movement = (await confirmNextOccurrence(user, salary.id)).movement
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
  const movement = (await confirmNextOccurrence(user, financing.id)).movement
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

  const paid = (await confirmNextOccurrence(user, financing.id)).movement
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
  const paid = (await confirmNextOccurrence(user, financing.id)).movement
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
  const paid = (await confirmNextOccurrence(user, financing.id)).movement

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
  const paid = (await confirmNextOccurrence(user, financing.id)).movement

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
  const provider = await createActor(user, { name: 'Netflix SAS' })
  const movement = (await confirmNextOccurrence(user, subscription.id)).movement

  const edited = await editCommitment(user, subscription.id, {
    label: 'Netflix Standard',
    actorId: provider.id,
    periodCount: 2,
  })
  assert.equal(edited.label, 'Netflix Standard')
  assert.equal(edited.actorId, provider.id)
  assert.equal(edited.periodCount, 2)
  // The amount has its own dated history: an edit never touches it.
  assert.equal(edited.amount, '13.49')

  // What already happened, happened with the actor it happened with.
  const [past] = await listMovements(user, { commitmentId: subscription.id })
  assert.equal(past!.id, movement.id)
  assert.equal(past!.sourceAccountId, account.id)

  // The next occurrence, though, follows the correction.
  const confirmed = (await confirmNextOccurrence(user, subscription.id)).movement
  assert.equal(confirmed.targetActorId, provider.id)
})

test('editing a commitment refuses a reference that is not the user’s', async () => {
  const user = await seedUser()
  const other = await seedUser('user-2')
  const { subscription } = await subscriptionFixture(user)
  const theirActor = await createActor(other, { name: 'Theirs' })

  await assert.rejects(
    editCommitment(user, subscription.id, { actorId: theirActor.id }),
    (e: DomainError) => e.code === 'actor_not_found',
  )
  await assert.rejects(
    editCommitment(user, subscription.id, { actorId: '00000000-0000-0000-0000-000000000000' }),
    (e: DomainError) => e.code === 'actor_not_found',
  )
})

test('an occurrence confirmed after a move lands on the account it really left', async () => {
  const user = await seedUser()
  // Dates hang off today: the point is which side of the move an occurrence
  // falls on, so the two must be built the same way.
  const first = addPeriod(today(), 'month', -2)
  const second = addPeriod(first, 'month', 1)
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const moved = await createAccount({ userId: user, name: 'Second', behavior: 'payment' })
  const actor = await createActor(user, { name: 'Netflix' })
  const subscription = await createSubscription(user, {
    label: 'Netflix',
    actorId: actor.id,
    accountId: account.id,
    amount: 13.49,
    periodUnit: 'month',
    firstDueOn: first,
  })

  const after = await moveAccount(user, subscription.id, moved.id, second)
  // The move is already in force, so that is the account it hits now.
  assert.equal(after.accountId, moved.id)
  assert.equal(after.nextAccountMove, null)

  // The occurrence left behind is still the old account's: it was debited
  // before the move, whatever day it is finally confirmed.
  const late = (await confirmNextOccurrence(user, subscription.id)).movement
  assert.equal(late.happenedOn, first)
  assert.equal(late.sourceAccountId, account.id)

  // The one falling on the move's own date is the new account's.
  const then = (await confirmNextOccurrence(user, subscription.id)).movement
  assert.equal(then.happenedOn, second)
  assert.equal(then.sourceAccountId, moved.id)

  const events = await commitmentEvents(user, subscription.id)
  const move = events.find((e) => e.type === 'account_changed')
  assert.equal(move?.occurredOn, second)
  assert.equal(move?.accountId, moved.id)
})

test('a move announced ahead waits for its date, and says so meanwhile', async () => {
  const user = await seedUser()
  const now = today()
  const nextMonth = addPeriod(now, 'month', 1)
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const moved = await createAccount({ userId: user, name: 'Second', behavior: 'payment' })
  const actor = await createActor(user, { name: 'Spotify' })
  const subscription = await createSubscription(user, {
    label: 'Spotify',
    actorId: actor.id,
    accountId: account.id,
    amount: 11.99,
    periodUnit: 'month',
    firstDueOn: now,
  })

  const announced = await moveAccount(user, subscription.id, moved.id, nextMonth)
  assert.equal(announced.accountId, account.id)
  assert.deepEqual(announced.nextAccountMove, { accountId: moved.id, effectiveOn: nextMonth })
  const [listed] = await listCommitmentsWithProgress(user)
  assert.equal(listed!.accountId, account.id)
  assert.deepEqual(listed!.nextAccountMove, { accountId: moved.id, effectiveOn: nextMonth })

  // Each expected occurrence carries the account of its own date, so nothing
  // has to be done on the day the move takes effect.
  const pending = await pendingOccurrences(user, nextMonth)
  assert.deepEqual(
    pending.filter((p) => !p.ahead).map((p) => [p.dueOn, p.accountId]),
    [
      [now, account.id],
      [nextMonth, moved.id],
    ],
  )

  assert.equal((await confirmNextOccurrence(user, subscription.id)).movement.sourceAccountId, account.id)
  assert.equal((await confirmNextOccurrence(user, subscription.id)).movement.sourceAccountId, moved.id)
})

test('a recurring income moves the account it is credited to', async () => {
  const user = await seedUser()
  const first = addPeriod(today(), 'month', -1)
  const account = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const moved = await createAccount({ userId: user, name: 'Second', behavior: 'payment' })
  const employer = await createActor(user, { name: 'ACME' })
  const salary = await createSubscription(user, {
    label: 'Salaire',
    actorId: employer.id,
    accountId: account.id,
    direction: 'incoming',
    amount: 2400,
    periodUnit: 'month',
    firstDueOn: first,
  })

  await moveAccount(user, salary.id, moved.id, first)
  const movement = (await confirmNextOccurrence(user, salary.id)).movement
  assert.equal(movement.kind, 'income')
  assert.equal(movement.targetAccountId, moved.id)
  assert.equal(movement.sourceActorId, employer.id)
})

test('a financing installment follows the account of its own due date', async () => {
  const user = await seedUser()
  const { financing, account } = await financingFixture(user)
  const moved = await createAccount({ userId: user, name: 'Second', behavior: 'payment' })

  // The plan is 2026-02-01, 2026-03-05, 2026-04-05: the move splits it.
  await moveAccount(user, financing.id, moved.id, '2026-03-05')

  assert.equal((await confirmNextOccurrence(user, financing.id)).movement.sourceAccountId, account.id)
  assert.equal((await confirmNextOccurrence(user, financing.id)).movement.sourceAccountId, moved.id)
  assert.equal((await confirmNextOccurrence(user, financing.id)).movement.sourceAccountId, moved.id)
})

test('moving to an account that is not the user’s is refused', async () => {
  const user = await seedUser()
  const other = await seedUser('user-2')
  const { subscription } = await subscriptionFixture(user)
  const theirs = await createAccount({ userId: other, name: 'Theirs', behavior: 'payment' })

  await assert.rejects(
    moveAccount(user, subscription.id, theirs.id),
    (e: DomainError) => e.code === 'account_not_found',
  )
  await assert.rejects(
    moveAccount(user, subscription.id, '00000000-0000-0000-0000-000000000000'),
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
