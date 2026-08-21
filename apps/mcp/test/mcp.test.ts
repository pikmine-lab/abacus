import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
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

  // Two categories, one mass; the groupless one is named as such.
  const byGroup = await call(client, 'analyze_spending', {
    from: '2026-08-01',
    to: '2026-08-31',
    groupBy: 'categoryGroup',
  })
  assert.deepEqual(byGroup.json(), [
    { categoryGroup: 'Vie quotidienne', gross: 90, net: 90 },
    { categoryGroup: '(none)', gross: 10, net: 10 },
  ])
})
