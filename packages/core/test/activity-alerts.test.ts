import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import { createAccount } from '../src/services/accounts.ts'
import { activityAlerts } from '../src/services/activityAlerts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, setActivityAccounts } from '../src/services/catalog.ts'
import { createLevy } from '../src/services/levies.ts'
import { declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/**
 * What a regime has to say today. Not one rate, ceiling or consequence below
 * exists in the code: they are rows these tests insert, exactly as a user or
 * the MCP would write them, and the sentence a crossing carries is theirs.
 */

const TODAY = '2026-06-30'

async function business(userId: string, name: string, closedOn?: string): Promise<string> {
  const activity = await createActivity(userId, { name })
  await db()`
    update activity set kind = 'business', started_on = '2026-01-01', revenue_basis = 'cash',
                        deductible_expenses = 'none', closed_on = ${closedOn ?? null}
    where id = ${activity.id}
  `
  return activity.id
}

/** Revenue of the year, so a threshold on the receipts has something to measure. */
async function earn(userId: string, activityId: string, amount: number): Promise<void> {
  const account = await createAccount({ userId, name: `Pro ${activityId.slice(0, 8)}`, behavior: 'payment' })
  await setActivityAccounts(userId, activityId, [account.id])
  const client = await createActor(userId, { name: `Client ${activityId.slice(0, 8)}`, activityId })
  await declareMovement(userId, {
    happenedOn: '2026-03-01',
    amount,
    sourceActorId: client.id,
    targetAccountId: account.id,
  })
}

async function insertThreshold(
  userId: string,
  activityId: string,
  row: {
    label: string
    measure?: string
    comparison?: 'lte' | 'gte'
    value: number
    consequence: string
    sourceUrl?: string
  },
): Promise<void> {
  await db()`
    insert into threshold (user_id, activity_id, label, measure, period_ref, comparison, value,
                           consequence, source_url)
    values (${userId}, ${activityId}, ${row.label}, ${row.measure ?? 'revenue'}, 'ytd',
            ${row.comparison ?? 'lte'}, ${row.value}, ${row.consequence}, ${row.sourceUrl ?? null})
  `
}

/** The plainest rule there is: a rate on the receipts, quarterly. Only its source dates matter here. */
async function insertLevy(
  userId: string,
  activityId: string,
  row: { name: string; status?: string; reviewOn?: string; verifiedOn?: string; sourceUrl?: string },
): Promise<void> {
  const sql = db()
  await sql`
    insert into levy (user_id, activity_id, name, kind, valid_from, base_measure, amount_form, rate,
                      period, due, status, review_on, verified_on, source_url)
    values (${userId}, ${activityId}, ${row.name}, 'social', '2026-01-01', 'revenue', 'rate', 20,
            'quarter', ${sql.json({ type: 'end_of_next_month' })}, ${row.status ?? 'confirmed'},
            ${row.reviewOn ?? null}, ${row.verifiedOn ?? null}, ${row.sourceUrl ?? null})
  `
}

test('a threshold the activity is nowhere near says nothing', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertThreshold(user, activityId, {
    label: 'VAT exemption',
    value: 40000,
    consequence: 'Add the VAT rule from the day it is crossed.',
  })
  await earn(user, activityId, 10000)

  assert.deepEqual(await activityAlerts(user, TODAY), [])
})

test('a threshold in sight is said while there is still room to act', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertThreshold(user, activityId, {
    label: 'VAT exemption',
    value: 40000,
    consequence: 'Add the VAT rule from the day it is crossed.',
  })
  await earn(user, activityId, 34000)

  const alerts = await activityAlerts(user, TODAY)
  assert.equal(alerts.length, 1)
  const alert = alerts[0]!
  assert.equal(alert.kind, 'threshold_near')
  assert.equal(alert.subject, 'VAT exemption')
  assert.equal(alert.activityName, 'Freelance')
  assert.ok(alert.kind === 'threshold_near')
  assert.equal(alert.current, 34000)
  assert.equal(alert.value, 40000)
})

test('a crossed threshold says what it costs, in the words the user wrote', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertThreshold(user, activityId, {
    label: 'Flat-rate ceiling',
    value: 40000,
    consequence: 'Close this activity and open the one that follows it.',
    sourceUrl: 'https://example.test/ceiling',
  })
  await earn(user, activityId, 45000)

  const alerts = await activityAlerts(user, TODAY)
  assert.equal(alerts.length, 1)
  const alert = alerts[0]!
  assert.equal(alert.kind, 'threshold_crossed')
  assert.ok(alert.kind === 'threshold_crossed')
  assert.equal(alert.current, 45000)
  assert.equal(alert.consequence, 'Close this activity and open the one that follows it.')
  assert.equal(alert.sourceUrl, 'https://example.test/ceiling')
})

test('a rule past its review day says so, with the day and the text it was read in', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertLevy(user, activityId, {
    name: 'Contributions',
    verifiedOn: '2025-01-02',
    reviewOn: '2026-01-01',
    sourceUrl: 'https://example.test/rule',
  })

  const alerts = await activityAlerts(user, TODAY)
  assert.equal(alerts.length, 1)
  const alert = alerts[0]!
  assert.equal(alert.kind, 'rule_review_due')
  assert.equal(alert.subject, 'Contributions')
  assert.ok(alert.kind === 'rule_review_due')
  assert.equal(alert.reviewOn, '2026-01-01')
  assert.equal(alert.verifiedOn, '2025-01-02')
  assert.equal(alert.sourceUrl, 'https://example.test/rule')
})

test('a rule no text ever fixed says its figure is uncertain, and a rule still in date says nothing', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertLevy(user, activityId, { name: 'Flat contribution', status: 'unconfirmed' })
  await insertLevy(user, activityId, { name: 'Training levy', reviewOn: '2027-01-01' })

  const alerts = await activityAlerts(user, TODAY)
  assert.equal(alerts.length, 1)
  const alert = alerts[0]!
  assert.equal(alert.kind, 'rule_unconfirmed')
  assert.equal(alert.subject, 'Flat contribution')
  assert.ok(alert.kind === 'rule_unconfirmed')
  assert.equal(alert.status, 'unconfirmed')
  assert.equal(alert.reviewOn, null)
})

test('the worst comes first: a crossing changes a regime, a stale source only dates a figure', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance')
  await insertLevy(user, activityId, { name: 'Contributions', reviewOn: '2026-01-01' })
  await insertThreshold(user, activityId, {
    label: 'Flat-rate ceiling',
    value: 40000,
    consequence: 'Close this activity and open the one that follows it.',
  })
  await earn(user, activityId, 45000)

  assert.deepEqual(
    (await activityAlerts(user, TODAY)).map((a) => a.kind),
    ['threshold_crossed', 'rule_review_due'],
  )
})

test('an analysis dimension carries no regime, so it alerts nothing', async () => {
  const user = await seedUser()
  const activity = await createActivity(user, { name: 'Household' })
  await insertThreshold(user, activity.id, {
    label: 'Ceiling',
    value: 100,
    consequence: 'Nothing happens: this activity has no regime.',
  })

  assert.deepEqual(await activityAlerts(user, TODAY), [])
})

test('a closed activity alerts nothing: its regime ended with it', async () => {
  const user = await seedUser()
  const activityId = await business(user, 'Freelance', '2026-05-31')
  await insertLevy(user, activityId, { name: 'Contributions', reviewOn: '2026-01-01' })

  assert.deepEqual(await activityAlerts(user, TODAY), [])
})

test('the alerts of one user never reach another', async () => {
  const mine = await seedUser('user-1')
  const theirs = await seedUser('user-2')
  const activityId = await business(theirs, 'Their freelance')
  await insertLevy(theirs, activityId, { name: 'Their contributions', reviewOn: '2026-01-01' })

  assert.deepEqual(await activityAlerts(mine, TODAY), [])
  assert.equal((await activityAlerts(theirs, TODAY)).length, 1)
})

test('a rule the engine cannot read becomes an alert, and the others still answer', async () => {
  const user = await seedUser()
  const broken = await createActivity(user, {
    name: 'Cassée',
    kind: 'business',
    startedOn: '2026-01-01',
  })
  const sound = await createActivity(user, {
    name: 'Saine',
    kind: 'business',
    startedOn: '2026-01-01',
  })
  // Something the sound activity has to say, so its silence would be a failure
  // rather than simply nothing to report.
  await createLevy(user, {
    activityId: sound.id,
    name: 'Cotisation',
    kind: 'social',
    validFrom: '2026-01-01',
    status: 'unconfirmed',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 10,
    period: 'month',
    due: { type: 'end_of_next_month' },
  })
  // Parameters the engine cannot read, which only a row written outside the
  // service can carry: the point is that the overview survives one.
  await db()`
    insert into levy (user_id, activity_id, name, kind, valid_from, base_measure, amount_form, brackets, period, due)
    values (${user}, ${broken.id}, 'Illisible', 'social', '2026-01-01', 'revenue', 'brackets',
            ${db().json({ mode: 'nope' })}, 'month', ${db().json({ type: 'end_of_next_month' })})
  `

  const alerts = await activityAlerts(user, '2026-09-05')
  const unreadable = alerts.filter((a) => a.kind === 'activity_unreadable')
  assert.equal(unreadable.length, 1)
  assert.equal(unreadable[0]!.activityName, 'Cassée')
  // The sound activity is still read: one misconfiguration does not blind the rest.
  assert.ok(alerts.some((a) => a.activityId === sound.id))
})
