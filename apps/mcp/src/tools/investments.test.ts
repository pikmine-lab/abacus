import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { declareAsset, setManualPrice } from '@abacus/core/services/investments'
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

test('manage_assets history: the price of an asset day by day, as decimals with their currency', async () => {
  const userId = await seedUser()
  const asset = await declareAsset(userId, { name: 'SCPI Rivage', nature: 'real_estate' })
  await setManualPrice(userId, asset.id, 200, '2026-01-31')
  await setManualPrice(userId, asset.id, 210.5, '2026-06-30')
  const reply = await call(userId, 'manage_assets', { action: 'history', name: 'SCPI Rivage' })
  assert.equal(reply.isError, false, reply.text)
  assert.deepEqual(reply.json(), {
    asset: 'SCPI Rivage',
    currency: 'EUR',
    days: [
      { day: '2026-01-31', price: '200.00' },
      { day: '2026-06-30', price: '210.50' },
    ],
  })
})

test('manage_assets history keeps the decimals a price carries beyond the cent', async () => {
  const userId = await seedUser()
  const asset = await declareAsset(userId, { name: 'Parts', nature: 'other' })
  await setManualPrice(userId, asset.id, 0.12345678, '2026-02-01')
  const { days } = (await call(userId, 'manage_assets', { action: 'history', name: 'Parts' })).json() as {
    days: { price: string }[]
  }
  assert.deepEqual(
    days.map((d) => d.price),
    ['0.12345678'],
  )
})

test('manage_assets history needs an asset the user holds or follows', async () => {
  const userId = await seedUser()
  assert.equal((await call(userId, 'manage_assets', { action: 'history' })).isError, true)
  assert.equal((await call(userId, 'manage_assets', { action: 'history', name: 'Inconnu' })).isError, true)
})

test('manage_assets history answers the window it is given', async () => {
  const userId = await seedUser()
  const asset = await declareAsset(userId, { name: 'SCPI Rivage', nature: 'real_estate' })
  await setManualPrice(userId, asset.id, 190, '2025-12-31')
  await setManualPrice(userId, asset.id, 200, '2026-01-31')
  await setManualPrice(userId, asset.id, 210.5, '2026-06-30')
  const reply = await call(userId, 'manage_assets', {
    action: 'history',
    name: 'SCPI Rivage',
    from: '2026-01-01',
    to: '2026-03-31',
  })
  assert.equal(reply.isError, false, reply.text)
  assert.deepEqual((reply.json() as { days: unknown[] }).days, [{ day: '2026-01-31', price: '200.00' }])
})

test('manage_assets history, without a window, answers the 366 days that end on the latest price', async () => {
  const userId = await seedUser()
  const asset = await declareAsset(userId, { name: 'SCPI Rivage', nature: 'real_estate' })
  await setManualPrice(userId, asset.id, 180, '2025-06-29')
  await setManualPrice(userId, asset.id, 190, '2025-06-30')
  await setManualPrice(userId, asset.id, 210.5, '2026-06-30')
  const { days } = (
    await call(userId, 'manage_assets', { action: 'history', name: 'SCPI Rivage' })
  ).json() as {
    days: { day: string }[]
  }
  assert.deepEqual(
    days.map((d) => d.day),
    ['2025-06-30', '2026-06-30'],
  )
})

test('manage_assets history refuses a window it cannot answer in one call', async () => {
  const userId = await seedUser()
  await declareAsset(userId, { name: 'Parts', nature: 'other' })
  const history = (window: Record<string, string>) =>
    call(userId, 'manage_assets', { action: 'history', name: 'Parts', ...window })
  assert.equal((await history({ from: '2025-01-01', to: '2026-01-02' })).isError, true)
  assert.equal((await history({ from: '2026-02-01', to: '2026-01-01' })).isError, true)
  assert.equal((await history({ from: '2026-01-01' })).isError, true)
  assert.equal((await history({ from: '2025-01-01', to: '2025-12-31' })).isError, false)
})
