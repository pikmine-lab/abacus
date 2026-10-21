import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { today } from '@abacus/core/domain/period'
import { createAccount } from '@abacus/core/services/accounts'
import { createActor } from '@abacus/core/services/actors'
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

async function call(userId: string, args: Record<string, unknown>) {
  const authInfo: AuthInfo = { token: 'test', clientId: userId, scopes: ['mcp'], extra: { userId } }
  const handler = createMcpHandler(({ authInfo: info }) => buildServer(userIdOf(info)))
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://in-process.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
    }),
  )
  const reply = (await client.callTool({ name: 'get_balance_history', arguments: args })) as {
    isError?: boolean
    content: { text: string }[]
  }
  const text = reply.content[0]!.text
  return { isError: reply.isError ?? false, text, json: () => JSON.parse(text) }
}

async function accountWithOneExpense(userId: string) {
  const account = await createAccount({
    userId,
    name: 'Courant',
    behavior: 'payment',
    openingBalance: 100,
    openedOn: '2026-03-01',
  })
  const shop = await createActor(userId, { name: 'Épicerie' })
  await declareMovement(userId, {
    happenedOn: '2026-03-05',
    amount: 30.5,
    sourceAccountId: account.id,
    targetActorId: shop.id,
  })
}

test('the balance of an account, day by day, as decimals with their currency', async () => {
  const userId = await seedUser()
  await accountWithOneExpense(userId)
  const reply = await call(userId, { account: 'Courant', from: '2026-03-04', to: '2026-03-06' })
  assert.equal(reply.isError, false, reply.text)
  assert.deepEqual(reply.json(), {
    account: 'Courant',
    currency: 'EUR',
    days: [
      { day: '2026-03-04', balance: '100.00' },
      { day: '2026-03-05', balance: '69.50' },
      { day: '2026-03-06', balance: '69.50' },
    ],
  })
})

test('with no window, the one the web home shows: this month, from the first declared day', async () => {
  const userId = await seedUser()
  await accountWithOneExpense(userId)
  const { days } = (await call(userId, { account: 'Courant' })).json() as { days: { day: string }[] }
  const month = today().slice(0, 7)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  const first = `${month}-01` > '2026-03-01' ? `${month}-01` : '2026-03-01'
  assert.equal(days[0]!.day, first)
  assert.equal(days.at(-1)!.day, last)
})

test('a window longer than 366 days, reversed, or an unknown account is refused', async () => {
  const userId = await seedUser()
  await accountWithOneExpense(userId)
  assert.equal(
    (await call(userId, { account: 'Courant', from: '2025-01-01', to: '2026-03-06' })).isError,
    true,
  )
  assert.equal(
    (await call(userId, { account: 'Courant', from: '2026-03-06', to: '2026-03-04' })).isError,
    true,
  )
  assert.equal(
    (await call(userId, { account: 'Inconnu', from: '2026-03-04', to: '2026-03-06' })).isError,
    true,
  )
})

test('an account named past 200 characters is not looked up', async () => {
  const userId = await seedUser()
  const name = 'x'.repeat(201)
  await createAccount({ userId, name, behavior: 'payment', openedOn: '2026-03-01' })
  assert.equal((await call(userId, { account: name, from: '2026-03-01', to: '2026-03-02' })).isError, true)
})
