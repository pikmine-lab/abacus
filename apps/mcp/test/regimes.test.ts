import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
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
  return { isError: result.isError, text, json: () => JSON.parse(text) as Record<string, never> }
}

/**
 * The catalog as an AI walks it: the questionnaire is the whole of its state,
 * so the answers go back in on every call and nothing is remembered for it.
 */
test('an AI walks the tree, previews a model and creates the activity it names', async () => {
  const client = await clientFor(await seedUser())

  const places = await call(client, 'browse_regimes', { action: 'jurisdictions' })
  const jurisdictions = places.json() as unknown as { id: string; models: { id: string }[] }[]
  assert.ok(jurisdictions.some((j) => j.id === 'fr'))

  let answers: Record<string, string> = {}
  for (let guard = 0; guard < 10; guard++) {
    const step = (
      await call(client, 'browse_regimes', { action: 'questions', jurisdiction: 'fr', answers })
    ).json() as unknown as {
      done: boolean
      question?: { id: string; label: string; options: { value: string }[] }
      models: { id: string }[]
    }
    if (step.done) {
      assert.deepEqual(
        step.models.map((m) => m.id),
        ['fr-micro-flat'],
      )
      break
    }
    const question = step.question!
    // The labels are what the AI puts to the user: they are written in French.
    assert.ok(question.label.length > 0)
    const preferred = question.options.find((o) => o.value === 'flat') ?? question.options[0]!
    answers = { ...answers, [question.id]: preferred.value }
  }

  const preview = (
    await call(client, 'browse_regimes', { action: 'preview', model: 'fr-micro-flat', answers })
  ).json() as unknown as {
    activity: { jurisdiction: string; regimeLabel: string }
    rules: { name: string; status: string }[]
    toAnnounce: { name: string; status: string }[]
    statedFigures: { name: string }[]
  }
  assert.equal(preview.activity.jurisdiction, 'France')
  assert.ok(preview.rules.some((rule) => rule.name === 'Cotisations sociales'))
  // What the AI has to repeat to the user is singled out, not left to be found.
  assert.ok(preview.toAnnounce.some((entry) => entry.status === 'unconfirmed'))
  assert.ok(preview.statedFigures.length > 0)

  const created = (
    await call(client, 'manage_activities', {
      action: 'create',
      name: 'Freelance',
      regime: 'fr-micro-flat',
      answers,
      startedOn: '2026-01-01',
    })
  ).json() as unknown as {
    jurisdiction: string
    regimeLabel: string
    rules: { name: string; status: string; source?: string; checkedOn?: string }[]
    thresholds: string[]
    copied: string
  }
  assert.equal(created.jurisdiction, 'France')
  assert.equal(created.regimeLabel, 'Micro-entreprise, versement libératoire')
  assert.ok(created.rules.every((rule) => rule.source && rule.checkedOn))
  assert.ok(created.thresholds.length > 0)
  assert.ok(created.copied.includes('manage_levies'))

  // The rules exist as the activity's own, readable by the tool that corrects them.
  const listed = (await call(client, 'manage_levies', { action: 'list', activity: 'Freelance' })).text
  assert.ok(listed.includes('Cotisations sociales'))
})

test('the regime path refuses what would state two answers to one question', async () => {
  const client = await clientFor(await seedUser())
  const answers = { activity_nature: 'liberal_bnc', income_tax: 'flat', declaration_period: 'quarter' }

  const clash = await call(client, 'manage_activities', {
    action: 'create',
    name: 'Double',
    regime: 'fr-micro-flat',
    answers: { ...answers, vat: 'franchise', acre: 'no' },
    revenueBasis: 'invoiced',
  })
  assert.equal(clash.isError, true)
  assert.match(clash.text, /revenueBasis/)

  const orphan = await call(client, 'manage_activities', {
    action: 'create',
    name: 'Sans modèle',
    answers,
  })
  assert.equal(orphan.isError, true)

  // A half-answered questionnaire writes nothing at all.
  const partial = await call(client, 'manage_activities', {
    action: 'create',
    name: 'Partiel',
    regime: 'fr-micro-flat',
    answers,
  })
  assert.equal(partial.isError, true)
  assert.match(partial.text, /browse_regimes/)
  const activities = (await call(client, 'manage_activities', { action: 'list' })).text
  assert.equal(activities.includes('Partiel'), false)

  const unknown = await call(client, 'browse_regimes', { action: 'questions', jurisdiction: 'atlantide' })
  assert.equal(unknown.isError, true)
  assert.match(unknown.text, /browse_regimes/)
})
