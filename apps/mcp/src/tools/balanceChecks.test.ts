import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '@abacus/core/services/accounts'
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

// 500 characters, each one an emoji written with two UTF-16 units, as the web accepts it.
const longestNote = '🙂'.repeat(500)

test('a check note is counted in characters: 500 emojis are kept, 501 refused', async () => {
  const userId = await seedUser()
  await createAccount({ userId, name: 'Courant', behavior: 'payment', openedOn: '2026-03-01' })
  const record = (note: string) =>
    call(userId, 'record_balance_check', { account: 'Courant', balance: 0, date: '2026-03-02', note })
  const kept = await record(longestNote)
  assert.equal(kept.isError, false, kept.text)
  assert.equal((await record(`${longestNote}🙂`)).isError, true)

  const [check] = (await call(userId, 'manage_balance_checks', { action: 'list' })).json() as {
    checkId: string
  }[]
  const correct = (note: string) =>
    call(userId, 'manage_balance_checks', { action: 'correct', check: check!.checkId, note })
  const corrected = await correct(longestNote)
  assert.equal(corrected.isError, false, corrected.text)
  assert.equal((await correct(`${longestNote}🙂`)).isError, true)
})
