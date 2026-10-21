import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '@abacus/core/services/accounts'
import { createActor } from '@abacus/core/services/actors'
import { createActivity, createCategory } from '@abacus/core/services/catalog'
import { createFinancing, createSubscription } from '@abacus/core/services/commitments'
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

interface Line {
  label: string
  payee?: string
  category?: string
  activity?: string
  monthlyExpectedRefund?: { amount: string; currency: string }
}

async function commitments(userId: string): Promise<Line[]> {
  const reply = await call(userId, 'list_commitments', { sortBy: 'label' })
  assert.equal(reply.isError, false, reply.text)
  const { commitments } = reply.json() as { commitments: Line[] }
  return commitments.map(({ label, payee, category, activity, monthlyExpectedRefund }) => ({
    label,
    payee,
    category,
    activity,
    monthlyExpectedRefund,
  }))
}

test('list_commitments says who a commitment pays, how it is filed, and what comes back a month', async () => {
  const userId = await seedUser()
  const account = await createAccount({
    userId,
    name: 'Courant',
    behavior: 'payment',
    openingBalance: 500,
    openedOn: '2026-01-01',
  })
  const leisure = await createCategory(userId, 'Loisirs')
  const workshop = await createActivity(userId, { name: 'Atelier' })
  const stream = await createActor(userId, { name: 'Streamflix' })
  const gym = await createActor(userId, { name: 'Salle' })
  const shop = await createActor(userId, { name: 'Magasin' })
  const paul = await createActor(userId, { name: 'Paul' })
  await createSubscription(userId, {
    label: 'Streaming',
    actorId: stream.id,
    accountId: account.id,
    categoryId: leisure.id,
    activityId: workshop.id,
    amount: 15,
    periodUnit: 'month',
    firstDueOn: '2026-03-05',
    refundShares: [{ debtorActorId: paul.id, amount: 5 }],
  })
  // Billed once a year: what comes back is said a month, like the cost.
  await createSubscription(userId, {
    label: 'Sport',
    actorId: gym.id,
    accountId: account.id,
    amount: 240,
    periodUnit: 'year',
    firstDueOn: '2026-09-01',
    refundShares: [{ debtorActorId: paul.id, amount: 60 }],
  })
  await createFinancing(userId, {
    label: 'Canapé',
    actorId: shop.id,
    accountId: account.id,
    installmentsTotal: 3,
    totalAmount: 900,
    firstDueOn: '2026-10-10',
  })
  assert.deepEqual(await commitments(userId), [
    {
      label: 'Canapé',
      payee: 'Magasin',
      category: undefined,
      activity: undefined,
      monthlyExpectedRefund: undefined,
    },
    {
      label: 'Sport',
      payee: 'Salle',
      category: undefined,
      activity: undefined,
      monthlyExpectedRefund: { amount: '5.00', currency: 'EUR' },
    },
    {
      label: 'Streaming',
      payee: 'Streamflix',
      category: 'Loisirs',
      activity: 'Atelier',
      monthlyExpectedRefund: { amount: '5.00', currency: 'EUR' },
    },
  ])
})
