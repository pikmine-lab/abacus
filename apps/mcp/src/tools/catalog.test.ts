import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createAccount } from '@abacus/core/services/accounts'
import { createActor, editActor } from '@abacus/core/services/actors'
import { createActivity } from '@abacus/core/services/catalog'
import { declareMovement, listMovements } from '@abacus/core/services/movements'
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

test('manage_actors list gives each actor the aliases that resolve to it', async () => {
  const userId = await seedUser()
  await createActor(userId, { name: "McDonald's", aliases: ['McDo', 'Macdo'] })
  await createActor(userId, { name: 'Boulangerie' })
  const reply = await call(userId, 'manage_actors', { action: 'list' })
  assert.equal(reply.isError, false, reply.text)
  assert.deepEqual(
    (reply.json() as { name: string; aliases: string[] }[]).map(({ name, aliases }) => ({ name, aliases })),
    [
      { name: 'Boulangerie', aliases: [] },
      { name: "McDonald's", aliases: ['Macdo', 'McDo'] },
    ],
  )
})

/**
 * An actor attached to Atelier, with two movements carrying no activity, one
 * still carrying its former activity, and one set to another on purpose.
 */
async function actorLeftBehind(userId: string) {
  const account = await createAccount({
    userId,
    name: 'Courant',
    behavior: 'payment',
    openingBalance: 500,
    openedOn: '2026-01-01',
  })
  const workshop = await createActivity(userId, { name: 'Atelier' })
  const former = await createActivity(userId, { name: 'Ancienne' })
  const other = await createActivity(userId, { name: 'Autre' })
  const printer = await createActor(userId, { name: 'Imprimerie' })
  const expense = (happenedOn: string, activityId?: string) =>
    declareMovement(userId, {
      happenedOn,
      amount: 10,
      sourceAccountId: account.id,
      targetActorId: printer.id,
      activityId,
    })
  await expense('2026-06-03')
  await expense('2026-07-10')
  await expense('2026-07-12', former.id)
  await expense('2026-05-01', other.id)
  await editActor(userId, printer.id, { activityId: workshop.id })
}

test('manage_actors preview_reattach counts what reattach_history would take, and since when', async () => {
  const userId = await seedUser()
  await actorLeftBehind(userId)
  const reply = await call(userId, 'manage_actors', { action: 'preview_reattach', actor: 'Imprimerie' })
  assert.equal(reply.isError, false, reply.text)
  assert.deepEqual(reply.json(), {
    actor: 'Imprimerie',
    activity: 'Atelier',
    movementsToReattach: 2,
    since: '2026-06-03',
  })
  // A preview changes nothing: both movements still carry no activity.
  assert.equal((await listMovements(userId, { activityId: null })).length, 2)
})

test('manage_actors preview_reattach takes the same scope as reattach_history', async () => {
  const userId = await seedUser()
  await actorLeftBehind(userId)
  const preview = async (args: Record<string, unknown>) =>
    (await call(userId, 'manage_actors', { action: 'preview_reattach', actor: 'Imprimerie', ...args })).json()
  assert.deepEqual(await preview({ from: '2026-07-01' }), {
    actor: 'Imprimerie',
    activity: 'Atelier',
    movementsToReattach: 1,
    since: '2026-07-10',
  })
  assert.deepEqual(await preview({ previousActivity: 'Ancienne' }), {
    actor: 'Imprimerie',
    activity: 'Atelier',
    movementsToReattach: 3,
    since: '2026-06-03',
  })
  assert.deepEqual(await preview({ from: '2026-08-01' }), {
    actor: 'Imprimerie',
    activity: 'Atelier',
    movementsToReattach: 0,
  })
  const moved = (
    await call(userId, 'manage_actors', {
      action: 'reattach_history',
      actor: 'Imprimerie',
      previousActivity: 'Ancienne',
    })
  ).json() as { movementsReattached: number }
  assert.equal(moved.movementsReattached, 3)
})

test('manage_actors preview_reattach needs an actor that passes an activity on', async () => {
  const userId = await seedUser()
  await createActor(userId, { name: 'Sans activité' })
  assert.equal((await call(userId, 'manage_actors', { action: 'preview_reattach' })).isError, true)
  const reply = await call(userId, 'manage_actors', { action: 'preview_reattach', actor: 'Sans activité' })
  assert.equal(reply.isError, true)
  assert.match(reply.text, /no activity/)
})
