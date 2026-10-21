import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '@abacus/core/services/accounts'
import { createActor } from '@abacus/core/services/actors'
import { createAdjustment, recordBalanceCheck } from '@abacus/core/services/balanceChecks'
import { createActivity } from '@abacus/core/services/catalog'
import { confirmNextOccurrence, createSubscription } from '@abacus/core/services/commitments'
import { declareInvoice, settleInvoice } from '@abacus/core/services/invoices'
import { declareMovement } from '@abacus/core/services/movements'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { seedUser, setupDb, teardownDb, truncateAll } from '../../../../packages/core/test/helpers.ts'
import { userIdOf } from '../auth.ts'
import { buildServer } from '../server.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function call(userId: string, tool: string, args: Record<string, unknown>) {
  const authInfo: AuthInfo = { token: 'test', clientId: userId, scopes: ['mcp'], extra: { userId } }
  const handler = createMcpHandler(({ authInfo: info }) => buildServer(userIdOf(info)))
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://in-process.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
    }),
  )
  const reply = (await client.callTool({ name: tool, arguments: args })) as {
    isError?: boolean
    content: { text: string }[]
  }
  const text = reply.content[0]!.text
  return { isError: reply.isError ?? false, text, json: () => JSON.parse(text) }
}

interface Row {
  id: string
  activity?: string
  commitment?: string
  invoice?: { reference?: string; issuedOn: string }
  origin?: string
}

async function movements(userId: string): Promise<Row[]> {
  const reply = await call(userId, 'list_movements', { sortBy: 'date', direction: 'asc' })
  assert.equal(reply.isError, false, reply.text)
  return (reply.json() as { movements: Row[] }).movements
}

/** What the reading panel of the web adds to a row: the links of a movement. */
const links = ({ activity, commitment, invoice, origin }: Row) => ({ activity, commitment, invoice, origin })

test('list_movements names the activity of a movement, and nothing it does not carry', async () => {
  const userId = await seedUser()
  const account = await createAccount({
    userId,
    name: 'Courant',
    behavior: 'payment',
    openingBalance: 500,
    openedOn: '2026-01-01',
  })
  const workshop = await createActivity(userId, { name: 'Atelier' })
  const shop = await createActor(userId, { name: 'Quincaillerie' })
  const spent = (happenedOn: string, activityId?: string) =>
    declareMovement(userId, {
      happenedOn,
      amount: 10,
      sourceAccountId: account.id,
      targetActorId: shop.id,
      activityId,
    })
  await spent('2026-03-01', workshop.id)
  await spent('2026-03-02')
  const [filed, plain] = await movements(userId)
  assert.deepEqual(links(filed!), {
    activity: 'Atelier',
    commitment: undefined,
    invoice: undefined,
    origin: undefined,
  })
  // Absent, not null: a link the movement does not carry is left out.
  assert.deepEqual(
    ['activity', 'commitment', 'invoice', 'origin'].filter((key) => key in plain!),
    [],
  )
})

test('list_movements ties an occurrence and the refund of its share to their commitment', async () => {
  const userId = await seedUser()
  const account = await createAccount({
    userId,
    name: 'Courant',
    behavior: 'payment',
    openingBalance: 500,
    openedOn: '2026-01-01',
  })
  const stream = await createActor(userId, { name: 'Streamflix' })
  const paul = await createActor(userId, { name: 'Paul' })
  const subscription = await createSubscription(userId, {
    label: 'Streaming',
    actorId: stream.id,
    accountId: account.id,
    amount: 15,
    periodUnit: 'month',
    firstDueOn: '2026-03-05',
    refundShares: [{ debtorActorId: paul.id, amount: 5 }],
  })
  const { movement: occurrence } = await confirmNextOccurrence(userId, subscription.id)
  await declareMovement(userId, {
    happenedOn: '2026-03-08',
    amount: 5,
    sourceActorId: paul.id,
    targetAccountId: account.id,
    refundsMovementId: occurrence.id,
  })
  await declareMovement(userId, {
    happenedOn: '2026-03-09',
    amount: 30,
    sourceActorId: paul.id,
    targetAccountId: account.id,
    reservesCommitmentId: subscription.id,
  })
  const rows = await movements(userId)
  assert.deepEqual(rows.map(links), [
    { activity: undefined, commitment: 'Streaming', invoice: undefined, origin: 'commitment' },
    { activity: undefined, commitment: 'Streaming', invoice: undefined, origin: undefined },
    { activity: undefined, commitment: 'Streaming', invoice: undefined, origin: undefined },
  ])
})

test('list_movements names the invoice an income settles, and the balance check an adjustment settles', async () => {
  const userId = await seedUser()
  const account = await createAccount({
    userId,
    name: 'Pro',
    behavior: 'payment',
    openingBalance: 100,
    openedOn: '2026-01-01',
  })
  const freelance = await createActivity(userId, {
    name: 'Freelance',
    kind: 'business',
    startedOn: '2026-01-01',
    accountIds: [account.id],
  })
  const client = await createActor(userId, { name: 'ACME', activityId: freelance.id })
  const invoice = await declareInvoice(userId, {
    activityId: freelance.id,
    actorId: client.id,
    reference: 'F-2026-001',
    issuedOn: '2026-03-01',
    baseAmount: 1000,
    vatRate: 0,
  })
  await settleInvoice(userId, invoice.id, { accountId: account.id, date: '2026-03-15' })
  const unknown = await createActor(userId, { name: 'Inconnu' })
  const check = await recordBalanceCheck(userId, account.id, 1090, '2026-03-31')
  await createAdjustment(userId, check.check.id, { actorId: unknown.id })
  const rows = await movements(userId)
  assert.deepEqual(rows.map(links), [
    {
      activity: 'Freelance',
      commitment: undefined,
      invoice: { reference: 'F-2026-001', issuedOn: '2026-03-01' },
      origin: undefined,
    },
    { activity: 'Freelance', commitment: undefined, invoice: undefined, origin: 'balanceCheck' },
  ])
})
