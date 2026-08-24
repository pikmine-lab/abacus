import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '@abacus/core/db'
import { addPeriod, today } from '@abacus/core/domain/period'
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
    account: 'Courant',
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

  // Renamed: a correction, and it carries no date.
  const corrected = (
    await call(client, 'update_commitment', {
      commitment: 'Netflix',
      label: 'Netflix Standard',
      periodUnit: 'year',
    })
  ).json() as { label: string; every: string; note: string }
  assert.equal(corrected.label, 'Netflix Standard')
  assert.equal(corrected.every, '1 year')
  assert.match(corrected.note, /already recorded are unchanged/)

  // The debit moving to another account is the other kind of gesture: dated,
  // declarable before it happens. Until that date the review shows both the
  // account in force and the move to come.
  await call(client, 'manage_accounts', { action: 'create', name: 'Second', behavior: 'payment' })
  const moveOn = addPeriod(today(), 'year', 1)
  const moved = (
    await call(client, 'change_commitment_account', {
      commitment: 'Netflix Standard',
      account: 'Second',
      effectiveOn: moveOn,
    })
  ).json() as { account: string; effectiveOn: string; note: string }
  assert.equal(moved.account, 'Second')
  assert.match(moved.note, /still land on the previous account/)
  const [reviewed] = (await call(client, 'list_commitments')).json() as {
    account: string
    movingTo?: { account: string; on: string }
  }[]
  assert.equal(reviewed!.account, 'Courant')
  assert.deepEqual(reviewed!.movingTo, { account: 'Second', on: moveOn })

  // The movements already recorded keep the account they happened on.
  const onOldAccount = (
    await call(client, 'list_movements', { from: '2026-01-01', to: '2026-12-31', account: 'Courant' })
  ).json() as unknown[]
  const onNewAccount = (
    await call(client, 'list_movements', { from: '2026-01-01', to: '2026-12-31', account: 'Second' })
  ).json() as unknown[]
  assert.equal(onOldAccount.length, 2)
  assert.equal(onNewAccount.length, 0)

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

  // The store pushes the last installment back and knocks 50 off it: the plan
  // is revised as a whole, from the ids it just read.
  interface ScheduleView {
    totalAmount: number
    installments: { id: string; position: number; dueOn: string; amount: number; status: string }[]
  }
  const shown = (
    await call(client, 'manage_financing_schedule', { action: 'show', commitment: 'Canapé en 4x' })
  ).json() as ScheduleView
  assert.deepEqual(
    shown.installments.map((i) => i.status),
    ['paid', 'paid', 'due', 'due'],
  )

  const revised = (
    await call(client, 'manage_financing_schedule', {
      action: 'revise',
      commitment: 'Canapé en 4x',
      installments: shown.installments.map((i) => ({
        id: i.id,
        dueOn: i.position === 4 ? '2026-12-05' : i.dueOn,
        amount: i.position === 4 ? 200 : i.amount,
      })),
    })
  ).json() as ScheduleView
  assert.equal(revised.totalAmount, 950)
  assert.deepEqual(revised.installments[3], {
    id: shown.installments[3]!.id,
    position: 4,
    dueOn: '2026-12-05',
    amount: 200,
    status: 'due',
  })

  const after = (await call(client, 'list_commitments')).json() as { remainingDue: number }[]
  assert.equal(after[0]!.remainingDue, 450)
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

test('the whole referential corrects itself through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', {
    action: 'create',
    name: 'Curent',
    behavior: 'payment',
    institution: 'Banque',
  })
  await call(client, 'manage_activities', { action: 'create', name: 'Frelance' })
  await call(client, 'manage_categories', { action: 'create', name: 'Corses', group: 'Quotidien' })
  await call(client, 'manage_actors', { action: 'create', name: 'ACME Crop' })

  const account = (
    await call(client, 'manage_accounts', {
      action: 'update',
      name: 'Curent',
      newName: 'Courant',
      behavior: 'savings',
      institution: 'none',
    })
  ).json() as { name: string; behavior: string; institution?: string }
  assert.deepEqual(account.name, 'Courant')
  assert.equal(account.behavior, 'savings')
  assert.equal(account.institution, undefined)

  const activity = (
    await call(client, 'manage_activities', { action: 'update', name: 'Frelance', newName: 'Freelance' })
  ).json() as { name: string }
  assert.equal(activity.name, 'Freelance')

  const category = (
    await call(client, 'manage_categories', {
      action: 'update',
      name: 'Corses',
      newName: 'Courses',
      group: 'none',
    })
  ).json() as { name: string; group?: string }
  assert.equal(category.name, 'Courses')
  assert.equal(category.group, undefined)

  // The actor takes the corrected name and the activity that was missing.
  const actor = (
    await call(client, 'manage_actors', {
      action: 'update',
      actor: 'ACME Crop',
      newName: 'ACME Corp',
      activity: 'Freelance',
    })
  ).json() as { name: string }
  assert.equal(actor.name, 'ACME Corp')
  assert.deepEqual((await call(client, 'manage_actors', { action: 'list' })).json(), [
    { name: 'ACME Corp', activity: 'Freelance' },
  ])

  // A closed account reopens: closing the wrong one is not a dead end.
  await call(client, 'manage_accounts', { action: 'close', name: 'Courant', closedOn: '2026-07-31' })
  const reopened = (await call(client, 'manage_accounts', { action: 'reopen', name: 'Courant' })).json() as {
    closedOn: null
  }
  assert.equal(reopened.closedOn, null)

  // A name already taken comes back as guidance.
  await call(client, 'manage_categories', { action: 'create', name: 'Loyer' })
  const taken = await call(client, 'manage_categories', {
    action: 'update',
    name: 'Courses',
    newName: 'loyer',
  })
  assert.equal(taken.isError, true)
  assert.match(taken.text, /already uses that name/)
})

test('a movement reads back with its account and its counterparty', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_accounts', { action: 'create', name: 'Livret', behavior: 'savings' })
  await call(client, 'manage_categories', { action: 'create', name: 'Courses' })
  await call(client, 'declare_movements', {
    createUnknownActors: true,
    movements: [
      {
        date: '2026-08-01',
        amount: 40,
        type: 'expense',
        account: 'Courant',
        actor: 'Carrefour',
        category: 'Courses',
      },
      { date: '2026-08-02', amount: 900, type: 'income', account: 'Courant', actor: 'ACME' },
      { date: '2026-08-03', amount: 200, type: 'transfer', account: 'Courant', toAccount: 'Livret' },
    ],
  })

  const rows = (await call(client, 'list_movements')).json() as {
    kind: string
    account: string
    counterparty: string
    category?: string
  }[]
  assert.deepEqual(
    rows.map((m) => [m.kind, m.account, m.counterparty, m.category]),
    [
      ['transfer', 'Courant', 'Livret', undefined],
      ['income', 'Courant', 'ACME', undefined],
      ['expense', 'Courant', 'Carrefour', 'Courses'],
    ],
  )
})

test('a foreign-currency expense through the MCP surface, statement euros given', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })

  // eurAmount short-circuits the rate lookup, so no price source is hit here;
  // the computed-rate path is covered by the core tests with a stubbed source.
  const declared = await call(client, 'declare_movements', {
    createUnknownActors: true,
    movements: [
      {
        date: '2026-08-01',
        amount: 99,
        currency: 'USD',
        eurAmount: 91.35,
        type: 'expense',
        account: 'Courant',
        actor: 'Diner',
      },
    ],
  })
  const [line] = (declared.json() as { results: { paid?: string; eurAmount?: number }[] }).results
  assert.equal(line?.paid, '99 USD')
  assert.equal(line?.eurAmount, 91.35)

  const [row] = (await call(client, 'list_movements')).json() as { amount: number; paid?: string }[]
  assert.equal(row?.amount, 91.35)
  assert.equal(row?.paid, '99 USD')

  // A transfer moves euros between owned accounts: a currency on it is refused.
  await call(client, 'manage_accounts', { action: 'create', name: 'Livret', behavior: 'savings' })
  const refused = await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-02',
        amount: 50,
        currency: 'USD',
        type: 'transfer',
        account: 'Courant',
        toAccount: 'Livret',
      },
    ],
  })
  assert.match(refused.text, /euros/)
})

test('a USD subscription through the MCP surface, converted where euros are needed', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })

  // The pair is seeded so no price source is hit: the conversion machinery
  // itself is covered by the core tests with a stubbed source.
  const sql = db()
  const [pair] = await sql<{ id: string }[]>`
    insert into instrument (kind, price_source, price_source_ref, name, symbol, currency)
    values ('currency', 'yahoo', 'USDEUR=X', 'USD/EUR', 'USD', 'EUR')
    returning id
  `
  await sql`insert into instrument_price (instrument_id, quoted_on, price) values (${pair!.id}, ${today()}, 0.9)`

  await call(client, 'manage_subscription', {
    action: 'create',
    label: 'US SaaS',
    actor: 'SaaS Inc',
    account: 'Courant',
    amount: 10,
    currency: 'USD',
    firstDueOn: today(),
  })

  // The committed cost is in euros at the latest rate; the row says its currency.
  const overview = (await call(client, 'get_overview')).json() as {
    monthlyCommittedCost: number
    pendingOccurrences: { amount: number; currency?: string }[]
  }
  assert.equal(overview.monthlyCommittedCost, 9)
  assert.deepEqual(
    overview.pendingOccurrences.map((p) => [p.amount, p.currency]),
    [[10, 'USD']],
  )

  // Confirmed with the bank's own euros: the movement carries both sides.
  const confirmed = (
    await call(client, 'confirm_due_movements', {
      items: [{ commitment: 'US SaaS', action: 'confirm', eurAmount: 9.12 }],
    })
  ).json() as { results: { amount: number; paid?: string }[] }
  assert.equal(confirmed.results[0]!.amount, 9.12)
  assert.equal(confirmed.results[0]!.paid, '10 USD')
})

test('a balance check is corrected through the MCP surface, adjustment included', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_actors', { action: 'create', name: 'Inconnu' })
  await call(client, 'declare_movements', {
    createUnknownActors: true,
    movements: [{ date: '2026-08-01', amount: 1000, type: 'income', account: 'Courant', actor: 'ACME' }],
  })
  const check = (
    await call(client, 'record_balance_check', { account: 'Courant', balance: 950, date: '2026-08-10' })
  ).json() as { checkId: string }
  await call(client, 'settle_check_gap', { checkId: check.checkId, actor: 'Inconnu' })

  const listed = (await call(client, 'manage_balance_checks', { action: 'list' })).json() as {
    checkId: string
    account: string
    gap: number
    settledByMovement?: string
  }[]
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.account, 'Courant')
  assert.equal(listed[0]!.gap, -50)
  assert.ok(listed[0]!.settledByMovement)

  // 900 was the real balance: the gap widens and the adjustment follows.
  const wider = (
    await call(client, 'manage_balance_checks', {
      action: 'correct',
      check: check.checkId,
      balance: 900,
    })
  ).json() as { gap: number; adjustment: string }
  assert.equal(wider.gap, -100)
  assert.match(wider.adjustment, /realigned/)
  const adjustment = ((await call(client, 'list_movements')).json() as { amount: number }[])[0]
  assert.equal(adjustment!.amount, 100)

  // Nothing left to settle: the adjustment is removed with the gap.
  const settled = (
    await call(client, 'manage_balance_checks', {
      action: 'correct',
      check: check.checkId,
      balance: 1000,
    })
  ).json() as { gap: number; adjustment: string }
  assert.equal(settled.gap, 0)
  assert.match(settled.adjustment, /removed/)
  assert.equal(((await call(client, 'list_movements')).json() as unknown[]).length, 1)

  await call(client, 'manage_balance_checks', { action: 'delete', check: check.checkId })
  assert.deepEqual((await call(client, 'manage_balance_checks', { action: 'list' })).json(), [])

  const gone = await call(client, 'manage_balance_checks', {
    action: 'correct',
    check: check.checkId,
    balance: 10,
  })
  assert.equal(gone.isError, true)
  assert.match(gone.text, /manage_balance_checks/)
})

test('an advance and its refund through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)

  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_actors', { action: 'create', name: 'Restaurant' })
  await call(client, 'manage_actors', { action: 'create', name: 'Alex' })

  // A claim without its share is refused, with what to do about it.
  const missing = await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-10',
        amount: 120,
        type: 'expense',
        account: 'Courant',
        actor: 'Restaurant',
        expectedRefundFrom: 'Alex',
      },
    ],
  })
  assert.match(missing.text, /expectedRefundAmount/)

  await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-10',
        amount: 120,
        type: 'expense',
        account: 'Courant',
        actor: 'Restaurant',
        expectedRefundFrom: 'Alex',
        expectedRefundAmount: 90,
      },
    ],
  })

  // The claim tells what is owed and where a refund lands: nothing to guess.
  const open = (await call(client, 'list_outstanding_advances')).json() as {
    movementId: string
    paid: number
    owed: number
    remaining: number
    debtor: string
    account: string
  }[]
  assert.equal(open.length, 1)
  assert.equal(open[0]!.paid, 120)
  assert.equal(open[0]!.owed, 90)
  assert.equal(open[0]!.remaining, 90)
  assert.equal(open[0]!.debtor, 'Alex')
  assert.equal(open[0]!.account, 'Courant')

  // Half of it comes back, then the rest: the claim closes on its own.
  await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-12',
        amount: 40,
        type: 'income',
        account: 'Courant',
        actor: 'Alex',
        refundsMovementId: open[0]!.movementId,
      },
    ],
  })
  const half = (await call(client, 'list_outstanding_advances')).json() as { remaining: number }[]
  assert.equal(half[0]!.remaining, 50)

  await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-13',
        amount: 50,
        type: 'income',
        account: 'Courant',
        actor: 'Alex',
        refundsMovementId: open[0]!.movementId,
      },
    ],
  })
  assert.deepEqual((await call(client, 'list_outstanding_advances')).json(), [])

  // Refunded on the spot: both movements, no claim left behind.
  const sameDay = await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-14',
        amount: 60,
        type: 'expense',
        account: 'Courant',
        actor: 'Restaurant',
        expectedRefundFrom: 'Alex',
        expectedRefundAmount: 30,
        alreadyRefunded: true,
      },
    ],
  })
  assert.equal((sameDay.json() as { declared: number; failed: number }).declared, 1)
  assert.deepEqual((await call(client, 'list_outstanding_advances')).json(), [])

  // The claim itself is repairable: a share mistyped, then dropped entirely.
  await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-08-15',
        amount: 80,
        type: 'expense',
        account: 'Courant',
        actor: 'Restaurant',
        expectedRefundFrom: 'Alex',
        expectedRefundAmount: 80,
      },
    ],
  })
  const [claim] = (await call(client, 'list_outstanding_advances')).json() as { movementId: string }[]
  await call(client, 'fix_movement', {
    movement: claim!.movementId,
    action: 'correct',
    expectedRefundAmount: 20,
  })
  const fixed = (await call(client, 'list_outstanding_advances')).json() as { owed: number }[]
  assert.equal(fixed[0]!.owed, 20)

  await call(client, 'fix_movement', {
    movement: claim!.movementId,
    action: 'correct',
    expectedRefundFrom: 'none',
  })
  assert.deepEqual((await call(client, 'list_outstanding_advances')).json(), [])
})

test('spending reads back by category group through the MCP surface', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_actors', { action: 'create', name: 'Commerce' })
  await call(client, 'manage_categories', { action: 'create', name: 'Courses', group: 'Vie quotidienne' })
  await call(client, 'manage_categories', { action: 'create', name: 'Livraison', group: 'Vie quotidienne' })
  await call(client, 'manage_categories', { action: 'create', name: 'Divers' })

  const line = (date: string, amount: number, category: string) => ({
    date,
    amount,
    type: 'expense',
    account: 'Courant',
    actor: 'Commerce',
    category,
  })
  await call(client, 'declare_movements', {
    movements: [
      line('2026-08-02', 60, 'Courses'),
      line('2026-08-03', 30, 'Livraison'),
      line('2026-08-04', 10, 'Divers'),
    ],
  })

  // Two categories, one mass; the groupless one is named as such. A mass comes
  // with what it merges, already totalled and ranked, so the caller never has
  // to add figures up or ask a second time to see inside it.
  const byGroup = await call(client, 'analyze_spending', {
    from: '2026-08-01',
    to: '2026-08-31',
    groupBy: 'categoryGroup',
  })
  // The reading travels with the figures: the same month has two legitimate
  // totals, so a table without its label could not be read out loud.
  assert.deepEqual(byGroup.json(), {
    reading: 'cash',
    window: 'movements settled between 2026-08-01 and 2026-08-31',
    rows: [
      {
        categoryGroup: 'Vie quotidienne',
        gross: 90,
        net: 90,
        movements: 2,
        categories: [
          { category: 'Courses', gross: 60, net: 60, movements: 1 },
          { category: 'Livraison', gross: 30, net: 30, movements: 1 },
        ],
      },
      {
        categoryGroup: '(none)',
        gross: 10,
        net: 10,
        movements: 1,
        categories: [{ category: 'Divers', gross: 10, net: 10, movements: 1 }],
      },
    ],
  })

  // The other axes answer flat, and every row says how many movements make it,
  // which is what turns a line into a list_movements call.
  const byCategory = await call(client, 'analyze_spending', {
    from: '2026-08-01',
    to: '2026-08-31',
    groupBy: 'category',
  })
  assert.deepEqual((byCategory.json() as { rows: unknown[] }).rows, [
    { category: 'Courses', gross: 60, net: 60, movements: 1 },
    { category: 'Livraison', gross: 30, net: 30, movements: 1 },
    { category: 'Divers', gross: 10, net: 10, movements: 1 },
  ])
})

test('a movement declared for another month reads back in that month', async () => {
  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_actors', { action: 'create', name: 'Employeur' })

  // August's salary, paid on the 2nd of September.
  const declared = await call(client, 'declare_movements', {
    movements: [
      {
        date: '2026-09-02',
        amount: 2400,
        type: 'income',
        account: 'Courant',
        actor: 'Employeur',
        month: '2026-08',
      },
    ],
  })
  assert.equal((declared.json() as { results: { month?: string }[] }).results[0]!.month, '2026-08')

  const inAugust = async (reading?: string) =>
    (await call(client, 'list_movements', { from: '2026-08-01', to: '2026-08-31', reading })).json() as {
      id: string
      month?: string
    }[]

  assert.equal((await inAugust()).length, 0)
  const [attached] = await inAugust('accrual')
  assert.equal(attached!.month, '2026-08')

  // Detaching it puts it back on its own date, on both sides.
  const fixed = await call(client, 'fix_movement', {
    movement: attached!.id,
    action: 'correct',
    month: 'none',
  })
  assert.equal((fixed.json() as { month?: string }).month, undefined)
  assert.equal((await inAugust('accrual')).length, 0)
})

test('investments: funding is a movement, what happens inside is an operation', async () => {
  // get_portfolio refreshes prices as it runs, and a test must not depend on
  // Yahoo being up or on what the market did today: the network is cut, which
  // also asserts that a dead source leaves the read working.
  const realFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('no network in tests'))
  after(() => {
    globalThis.fetch = realFetch
  })

  const user = await seedUser()
  const client = await clientFor(user)
  await call(client, 'manage_accounts', { action: 'create', name: 'Courant', behavior: 'payment' })
  await call(client, 'manage_accounts', { action: 'create', name: 'PEA', behavior: 'investment' })
  await call(client, 'manage_assets', {
    action: 'create',
    name: 'Monde',
    source: 'yahoo',
    reference: 'CW8.PA',
    kind: 'security',
    description: 'Amundi MSCI World',
  })

  await call(client, 'declare_movements', {
    movements: [{ date: '2026-01-02', amount: 5000, type: 'transfer', account: 'Courant', toAccount: 'PEA' }],
  })
  const recorded = await call(client, 'record_investment_operations', {
    operations: [
      { date: '2026-01-05', account: 'PEA', type: 'buy', asset: 'Monde', quantity: 5, amount: 3000 },
      { date: '2026-01-05', account: 'PEA', type: 'fee', amount: 12 },
      { date: '2026-02-10', account: 'PEA', type: 'dividend', asset: 'Monde', amount: 40 },
    ],
  })
  assert.equal((recorded.json() as { recorded: number }).recorded, 3)

  // No price is reachable, so nothing is valued and the return says so rather
  // than counting the holding as worthless.
  const unpriced = (await call(client, 'get_portfolio')).json() as {
    accounts: { cash: number; value: number; totalReturn: number | null; unpricedPositions?: number }[]
  }
  assert.equal(unpriced.accounts[0]!.cash, 2028) // 5000 - 3000 - 12 + 40
  assert.equal(unpriced.accounts[0]!.value, 2028)
  assert.equal(unpriced.accounts[0]!.totalReturn, null)
  assert.equal(unpriced.accounts[0]!.unpricedPositions, 1)

  // A hand-typed price only belongs to what no source quotes.
  const refused = await call(client, 'manage_assets', {
    action: 'set_price',
    name: 'Monde',
    price: 700,
    pricedOn: '2026-03-01',
  })
  assert.ok(refused.isError)
  assert.match(refused.text, /its price comes from the market/)

  await call(client, 'manage_assets', { action: 'create', name: 'SCPI' })
  await call(client, 'record_investment_operations', {
    operations: [
      { date: '2026-01-06', account: 'PEA', type: 'buy', asset: 'SCPI', quantity: 10, amount: 1000 },
    ],
  })
  const priced = await call(client, 'manage_assets', {
    action: 'set_price',
    name: 'SCPI',
    price: 108,
    pricedOn: '2026-03-01',
  })
  assert.deepEqual(priced.json(), { name: 'SCPI', price: 108, on: '2026-03-01' })
  const withPrice = (await call(client, 'get_portfolio', { account: 'PEA' })).json() as {
    accounts: { positions: { asset: string; value: number | null; unrealizedGain: number | null }[] }[]
  }
  const scpi = withPrice.accounts[0]!.positions.find((p) => p.asset === 'SCPI')
  assert.equal(scpi!.value, 1080)
  assert.equal(scpi!.unrealizedGain, 80)

  // The purchase is nowhere near the expenses: it is not one.
  const spending = await call(client, 'analyze_spending', {
    from: '2026-01-01',
    to: '2026-12-31',
    groupBy: 'category',
  })
  assert.equal((spending.json() as { rows: unknown[] }).rows.length, 0)

  // What the interface must refuse, and say why.
  const onChecking = await call(client, 'record_investment_operations', {
    operations: [{ date: '2026-01-05', account: 'Courant', type: 'fee', amount: 5 }],
  })
  assert.ok(onChecking.isError)
  assert.match(onChecking.text, /Only an investment account carries operations/)

  const tooMany = await call(client, 'record_investment_operations', {
    operations: [
      { date: '2026-03-05', account: 'PEA', type: 'sell', asset: 'Monde', quantity: 9, amount: 100 },
    ],
  })
  assert.ok(tooMany.isError)
  assert.match(tooMany.text, /sell more than the account holds/)

  const unknown = await call(client, 'record_investment_operations', {
    operations: [
      { date: '2026-03-05', account: 'PEA', type: 'buy', asset: 'Nasdaq', quantity: 1, amount: 100 },
    ],
  })
  assert.ok(unknown.isError)
  assert.match(unknown.text, /No asset named "Nasdaq"/)

  // One instrument is one holding, so declaring it again hands back what is
  // already there under its own name instead of splitting the position in half.
  const twice = await call(client, 'manage_assets', {
    action: 'create',
    name: 'World',
    source: 'yahoo',
    reference: 'CW8.PA',
    kind: 'security',
  })
  assert.ok(!twice.isError, twice.text)
  assert.equal((twice.json() as { name: string }).name, 'Monde')

  // A price a share, which is what a broker displays: the MCP multiplies nothing
  // itself, so the cost basis cannot pick up a rounding of its own.
  const byUnit = await call(client, 'record_investment_operations', {
    operations: [
      {
        date: '2026-04-02',
        account: 'PEA',
        type: 'buy',
        asset: 'Monde',
        quantity: 12.5,
        unitPrice: 22.57,
      },
    ],
  })
  assert.ok(!byUnit.isError, byUnit.text)
  assert.equal((byUnit.json() as { operations: { amount: number }[] }).operations[0]!.amount, 282.13)

  const both = await call(client, 'record_investment_operations', {
    operations: [
      {
        date: '2026-04-02',
        account: 'PEA',
        type: 'buy',
        asset: 'Monde',
        quantity: 1,
        amount: 20,
        unitPrice: 22.57,
      },
    ],
  })
  assert.ok(both.isError)
  assert.match(both.text, /either a total amount or a unit price/)

  // The listing says which assets are held and which are only watched, and a
  // watched one can be forgotten while a held one cannot.
  await call(client, 'manage_assets', {
    action: 'create',
    name: 'Nasdaq',
    source: 'yahoo',
    reference: 'EQQQ.PA',
    kind: 'security',
  })
  const listed = (await call(client, 'manage_assets', { action: 'list' })).json() as {
    name: string
    status: string
  }[]
  assert.equal(listed.find((a) => a.name === 'Nasdaq')!.status, 'followed')
  assert.equal(listed.find((a) => a.name === 'Monde')!.status, 'held')

  const dropped = await call(client, 'manage_assets', { action: 'unfollow', name: 'Nasdaq' })
  assert.ok(!dropped.isError, dropped.text)
  const stillHeld = await call(client, 'manage_assets', { action: 'unfollow', name: 'Monde' })
  assert.ok(stillHeld.isError)
  assert.match(stillHeld.text, /part of the history/)

  const operations = await call(client, 'list_investment_operations', { account: 'PEA' })
  assert.equal((operations.json() as unknown[]).length, 5)
})
