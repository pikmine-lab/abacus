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

/**
 * Exercises the real MCP surface in-process: same handler as production, with
 * a pre-verified AuthInfo standing in for the API-key gate.
 */
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

interface ToolReply {
  isError?: boolean
  text: string
  json: () => unknown
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: { type: string; text: string }[]
  }
  const text = result.content.map((c) => c.text).join('\n')
  return { isError: result.isError, text, json: () => JSON.parse(text) }
}

test('full declarative session through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)

  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_accounts', { action: 'create', name: 'Livret', behavior: 'savings' })
  await call(client, 'manage_activities', { action: 'create', name: 'Freelance' })
  await call(client, 'manage_categories', { action: 'create', name: 'Courses' })
  await call(client, 'manage_actors', { action: 'create', name: "McDonald's", aliases: ['McDo', 'Macdo'] })
  await call(client, 'manage_actors', { action: 'create', name: 'ACME', activity: 'Freelance' })

  // Unknown actor: the line fails with guidance, the rest of the batch passes.
  const declared = await call(client, 'declare_movements', {
    movements: [
      { date: '2026-08-01', amount: 1500, type: 'income', account: 'Courant', actor: 'ACME' },
      { date: '2026-08-02', amount: 300, type: 'transfer', account: 'Courant', toAccount: 'Livret' },
      {
        date: '2026-08-03',
        amount: 12.5,
        type: 'expense',
        account: 'Courant',
        actor: 'Macdo',
        category: 'Courses',
      },
      { date: '2026-08-04', amount: 20, type: 'expense', account: 'Courant', actor: 'Glovo' },
    ],
  })
  const batch = declared.json() as {
    declared: number
    failed: number
    results: { ok: boolean; error?: string }[]
  }
  assert.equal(batch.declared, 3)
  assert.equal(batch.failed, 1)
  assert.match(batch.results[3]!.error!, /createUnknownActors/)

  // Retry the failed line with explicit creation.
  const retried = await call(client, 'declare_movements', {
    movements: [{ date: '2026-08-04', amount: 20, type: 'expense', account: 'Courant', actor: 'Glovo' }],
    createUnknownActors: true,
  })
  assert.equal((retried.json() as { declared: number }).declared, 1)

  // The freelance income inherited its activity from the actor.
  const byActivity = await call(client, 'list_movements', { activity: 'Freelance' })
  assert.equal((byActivity.json() as unknown[]).length, 1)

  // Overview: balances reflect the movements, transfer stayed neutral.
  const overview = (await call(client, 'get_overview')).json() as {
    accounts: { name: string; balance: number }[]
    monthlyCommittedCost: number
  }
  const balances = Object.fromEntries(overview.accounts.map((a) => [a.name, a.balance]))
  assert.equal(balances.Courant, 1167.5)
  assert.equal(balances.Livret, 300)

  // Balance check: reality says 1150, so 17.50 of spending is missing.
  const check = (
    await call(client, 'record_balance_check', { account: 'Courant', balance: 1150, date: '2026-08-10' })
  ).json() as { checkId: string; gap: number; guidance: string }
  assert.equal(check.gap, -17.5)
  await call(client, 'manage_actors', { action: 'create', name: 'Inconnu' })
  const settled = (
    await call(client, 'settle_check_gap', { checkId: check.checkId, actor: 'Inconnu' })
  ).json() as { amount: number; kind: string }
  assert.equal(settled.amount, 17.5)
  assert.equal(settled.kind, 'expense')
})

test('subscription lifecycle through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })

  await call(client, 'manage_subscription', {
    action: 'create',
    label: 'Netflix',
    actor: 'Netflix',
    account: 'Courant',
    amount: 13.49,
    firstDueOn: '2026-08-01',
  })

  const overview = (await call(client, 'get_overview')).json() as {
    pendingOccurrences: { commitment: string; dueOn: string }[]
    monthlyCommittedCost: number
  }
  assert.deepEqual(overview.pendingOccurrences[0], {
    commitment: 'Netflix',
    dueOn: '2026-08-01',
    amount: 13.49,
    direction: 'outgoing',
  })
  assert.equal(overview.monthlyCommittedCost, 13.49)

  // The real debit was higher. Confirmed without qualifying it, the divergence
  // is a one-off: the reference amount is left alone and the answer says so.
  const oneOff = (
    await call(client, 'confirm_due_movements', {
      items: [{ commitment: 'Netflix', action: 'confirm', amount: 15.99 }],
    })
  ).json() as { results: { amount: number; expected?: number; reference?: string }[] }
  assert.equal(oneOff.results[0]!.amount, 15.99)
  assert.equal(oneOff.results[0]!.expected, 13.49)
  assert.match(oneOff.results[0]!.reference!, /one-off/)
  assert.equal(((await call(client, 'list_commitments')).json() as { amount: number }[])[0]!.amount, 13.49)

  // Said to be the new norm, the same gesture also moves the reference and
  // records it, so the price history shows when it changed.
  const permanent = (
    await call(client, 'confirm_due_movements', {
      items: [{ commitment: 'Netflix', action: 'confirm', amount: 15.99, amountIsTheNewNorm: true }],
    })
  ).json() as { results: { reference?: string }[] }
  assert.match(permanent.results[0]!.reference!, /Updated/)
  await call(client, 'manage_subscription', {
    action: 'set_judgment',
    commitment: 'Netflix',
    judgment: 'reducible',
    judgmentNote: 'Passer au palier avec pub ?',
  })

  const commitments = (await call(client, 'list_commitments')).json() as {
    label: string
    monthlyEquivalent: number
    judgment: string
  }[]
  assert.equal(commitments[0]!.monthlyEquivalent, 15.99)
  assert.equal(commitments[0]!.judgment, 'reducible')

  // Errors come back as guidance, not stack traces.
  const unknown = await call(client, 'confirm_due_movements', {
    items: [{ commitment: 'Spotify', action: 'confirm' }],
  })
  assert.match((unknown.json() as { results: { error: string }[] }).results[0]!.error, /No commitment/)
})

test('financing tracked to settlement through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })

  // Stated the way the contract states it: a total over N installments.
  const financing = (
    await call(client, 'declare_financing', {
      label: 'Canapé en 4x',
      actor: 'BigStore',
      account: 'Courant',
      totalAmount: 1000,
      installmentsTotal: 4,
      firstDueOn: '2026-08-05',
    })
  ).json() as { totalAmount: number; schedule: { dueOn: string; amount: number }[] }
  assert.equal(financing.totalAmount, 1000)
  // The plan it wrote comes back, so an agent can report it without asking again.
  assert.deepEqual(
    financing.schedule.map((i) => [i.dueOn, i.amount]),
    [
      ['2026-08-05', 250],
      ['2026-09-05', 250],
      ['2026-10-05', 250],
      ['2026-11-05', 250],
    ],
  )

  await call(client, 'confirm_due_movements', {
    items: [
      { commitment: 'Canapé en 4x', action: 'confirm' },
      { commitment: 'Canapé en 4x', action: 'confirm' },
    ],
  })

  const commitments = (await call(client, 'list_commitments')).json() as {
    label: string
    paidInstallments: string
    remainingDue: number
  }[]
  assert.equal(commitments[0]!.paidInstallments, '2/4')
  assert.equal(commitments[0]!.remainingDue, 500)
})

test('a mistyped movement is repaired through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_accounts', { action: 'create', name: 'Livret', behavior: 'savings' })
  await call(client, 'manage_categories', { action: 'create', name: 'Courses' })

  await call(client, 'declare_movements', {
    createUnknownActors: true,
    movements: [
      {
        date: '2026-08-10',
        amount: 90,
        type: 'expense',
        account: 'Courant',
        actor: 'Carrefour',
        category: 'Courses',
      },
    ],
  })
  const [declared] = (await call(client, 'list_movements')).json() as { id: string; amount: number }[]

  // A typo on the amount: corrected in place, everything else untouched.
  const fixed = (
    await call(client, 'fix_movement', { movement: declared!.id, action: 'correct', amount: 79.9 })
  ).json() as { amount: number; kind: string }
  assert.equal(fixed.amount, 79.9)
  assert.equal(fixed.kind, 'expense')

  // It was not an expense at all but a transfer between two owned accounts:
  // the kind is re-derived and the category cannot survive it.
  const retyped = (
    await call(client, 'fix_movement', {
      movement: declared!.id,
      action: 'correct',
      type: 'transfer',
      account: 'Courant',
      toAccount: 'Livret',
      category: 'none',
    })
  ).json() as { kind: string }
  assert.equal(retyped.kind, 'transfer')

  // An unknown id is guidance, not a stack trace.
  const missing = await call(client, 'fix_movement', {
    movement: '00000000-0000-0000-0000-000000000000',
    action: 'delete',
  })
  assert.equal(missing.isError, true)
  assert.match(missing.text, /list_movements/)

  await call(client, 'fix_movement', { movement: declared!.id, action: 'delete' })
  assert.deepEqual((await call(client, 'list_movements')).json(), [])
})
