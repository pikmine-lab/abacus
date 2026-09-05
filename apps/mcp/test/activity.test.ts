import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '@abacus/core/db'
import { today } from '@abacus/core/domain/period'
import { createAccount } from '@abacus/core/services/accounts'
import { createActor } from '@abacus/core/services/actors'
import { createActivity, createCategory, setActivityAccounts } from '@abacus/core/services/catalog'
import { declareMovement } from '@abacus/core/services/movements'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { seedUser, setupDb, teardownDb, truncateAll } from '../../../packages/core/test/helpers.ts'
import { userIdOf } from '../src/auth.ts'
import { buildServer } from '../src/server.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function clientFor(userId: string): Promise<Client> {
  const authInfo: AuthInfo = { token: 'test', clientId: userId, scopes: ['mcp'], extra: { userId } }
  const handler = createMcpHandler(({ authInfo: info }) => buildServer(userIdOf(info)))
  const transport = new StreamableHTTPClientTransport(new URL('http://in-process.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
  })
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(transport)
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: { type: string; text: string }[]
  }
  const text = result.content.map((c) => c.text).join('\n')
  return { isError: result.isError, text, json: () => JSON.parse(text) as Record<string, unknown> }
}

/**
 * The statement as an AI receives it. The regime below is data, written the
 * way the configuration tools write it; what is checked here is that the tool
 * answers with the figures and says what they are, since its answer is the
 * only thing the AI on the other side ever sees.
 */
async function activityWithOneRule(user: string) {
  const activity = await createActivity(user, { name: 'Freelance' })
  await db()`
    update activity set kind = 'business', started_on = '2026-01-01', revenue_basis = 'cash',
                        deductible_expenses = 'none', regime_label = 'Flat-rate'
    where id = ${activity.id}
  `
  const account = await createAccount({ userId: user, name: 'Pro', behavior: 'payment' })
  await setActivityAccounts(user, activity.id, [account.id])
  const client = await createActor(user, { name: 'ACME', activityId: activity.id })
  const social = await createCategory(user, 'Social contributions')
  const sql = db()
  await sql`
    insert into levy (user_id, activity_id, name, kind, valid_from, base_measure, amount_form, rate,
                      period, due, settlement_category_id, source_url, verified_on, status)
    values (${user}, ${activity.id}, 'Contributions', 'social', '2026-01-01', 'revenue', 'rate', 25.6,
            'quarter', ${sql.json({ type: 'end_of_next_month' })}, ${social.id},
            'https://example.test/rule', '2026-01-02', 'extended_by_default')
  `
  await declareMovement(user, {
    happenedOn: '2026-02-10',
    amount: 10000,
    sourceActorId: client.id,
    targetAccountId: account.id,
  })
  return { activityId: activity.id, accountName: 'Pro' }
}

test('the statement comes back whole, with the basis and the state of its figures', async () => {
  const user = await seedUser()
  await activityWithOneRule(user)
  const client = await clientFor(user)

  const reply = await call(client, 'get_activity_statement', { activity: 'Freelance', year: 2026 })
  assert.equal(reply.isError, undefined)
  const statement = reply.json()
  const activity = statement.activity as Record<string, unknown>
  assert.equal(activity.regime, 'Flat-rate')
  assert.match(String(activity.basis), /^cash: /)
  assert.match(String(statement.estimates), /estimate/)
  const levies = statement.levies as Record<string, unknown>[]
  assert.equal(levies.length, 1)
  assert.equal(levies[0]!.status, 'extended_by_default')
  assert.equal(levies[0]!.accrued, 2560)
  assert.equal(levies[0]!.reserve, 2560)
  assert.equal(levies[0]!.settledIn, 'Social contributions')
  const schedule = statement.schedule as Record<string, unknown>[]
  assert.equal(schedule.length, 4)
  assert.equal((schedule[0]!.declaration as { to: string }).to, '2026-04-30')
})

test('settling a due date through the tool writes the movement and drops the reserve', async () => {
  const user = await seedUser()
  await activityWithOneRule(user)
  const client = await clientFor(user)

  const paid = await call(client, 'confirm_levy_payment', {
    activity: 'Freelance',
    levy: 'Contributions',
    periodStart: '2026-01-01',
    amount: 2560,
    date: '2026-04-20',
    account: 'Pro',
    actor: 'Collector',
  })
  assert.equal(paid.isError, undefined)
  assert.equal(paid.json().amount, 2560)

  const after = (await call(client, 'get_activity_statement', { activity: 'Freelance', year: 2026 })).json()
  const levy = (after.levies as Record<string, unknown>[])[0]!
  assert.equal(levy.paid, 2560)
  assert.equal(levy.reserve, 0)
  assert.equal((after.schedule as Record<string, unknown>[])[0]!.status, 'paid')
})

test('an unknown rule answers with the rules that exist', async () => {
  const user = await seedUser()
  await activityWithOneRule(user)
  const client = await clientFor(user)

  const reply = await call(client, 'confirm_levy_payment', {
    activity: 'Freelance',
    levy: 'VAT',
    periodStart: '2026-01-01',
    amount: 100,
    date: '2026-04-20',
    account: 'Pro',
    actor: 'Collector',
  })
  assert.equal(reply.isError, true)
  assert.match(reply.text, /Contributions/)
})

/**
 * A regime that has something to say today, written entirely through the
 * tools an AI would use. The dates hang off today so the fixture stays inside
 * the fiscal year the overview reads, whatever day the suite runs.
 */
async function regimeWithSomethingToSay(client: Client) {
  const now = today()
  const yearStart = `${now.slice(0, 4)}-01-01`
  await call(client, 'manage_activities', {
    action: 'create',
    name: 'Freelance',
    kind: 'business',
    vatRegistered: true,
    defaultVatRate: 20,
    deductibleExpenses: 'all',
  })
  await call(client, 'manage_accounts', {
    action: 'create',
    name: 'Pro',
    behavior: 'payment',
    activity: 'Freelance',
  })
  await call(client, 'manage_actors', { action: 'create', name: 'ACME', activity: 'Freelance' })
  await call(client, 'declare_movements', {
    movements: [{ date: now, amount: 45000, type: 'income', account: 'Pro', actor: 'ACME' }],
  })
  await call(client, 'manage_thresholds', {
    action: 'create',
    activity: 'Freelance',
    label: 'Flat-rate ceiling',
    measure: 'revenue',
    value: 40000,
    consequence: 'Close this activity and open the one that follows it.',
    sourceUrl: 'https://example.test/ceiling',
    verifiedOn: yearStart,
  })
  await call(client, 'manage_levies', {
    action: 'create',
    activity: 'Freelance',
    name: 'Contributions',
    kind: 'social',
    validFrom: yearStart,
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 20,
    period: 'quarter',
    due: { type: 'end_of_next_month' },
    sourceUrl: 'https://example.test/rule',
    verifiedOn: yearStart,
    reviewOn: yearStart,
  })
  return { now }
}

test('the overview carries what a regime has to say, and says it switches nothing', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await regimeWithSomethingToSay(client)

  const alerts = (await call(client, 'get_overview')).json().activityAlerts as Record<string, unknown>[]
  assert.equal(alerts.length, 2)
  assert.equal(alerts[0]!.alert, 'threshold_crossed')
  assert.equal(alerts[0]!.about, 'Flat-rate ceiling')
  assert.equal(alerts[0]!.activity, 'Freelance')
  assert.equal(alerts[0]!.current, 45000)
  // The sentence comes back exactly as the user wrote it: what a crossing
  // costs is a fact of a regime, and the tool never phrases one of its own.
  assert.equal(alerts[0]!.consequence, 'Close this activity and open the one that follows it.')
  assert.equal(alerts[1]!.alert, 'rule_review_due')
  assert.equal(alerts[1]!.about, 'Contributions')
})

test('an expense of a registered activity says the VAT inside it, and nothing else may', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  const { now } = await regimeWithSomethingToSay(client)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })

  const declared = (
    await call(client, 'declare_movements', {
      createUnknownActors: true,
      movements: [
        {
          date: now,
          amount: 120,
          type: 'expense',
          account: 'Pro',
          actor: 'Supplier',
          activity: 'Freelance',
          vatAmount: 20,
        },
        // No activity, so no return will ever reclaim it: refused rather than
        // written and forgotten.
        { date: now, amount: 60, type: 'expense', account: 'Courant', actor: 'Baker', vatAmount: 10 },
      ],
    })
  ).json() as { declared: number; failed: number; results: Record<string, unknown>[] }
  assert.equal(declared.declared, 1)
  assert.equal(declared.failed, 1)
  assert.equal(declared.results[0]!.vatAmount, 20)
  assert.match(String(declared.results[1]!.error), /VAT-registered business activity/)

  // The statement reads it back: what the purchase bore comes off what the
  // year collected.
  const statement = (
    await call(client, 'get_activity_statement', { activity: 'Freelance', year: Number(now.slice(0, 4)) })
  ).json()
  assert.equal((statement.year as Record<string, unknown>).vatDeductible, 20)
})
