import assert from 'node:assert/strict'
import { test } from 'node:test'
import { driverNames } from '../drivers.ts'
import { gestures, informations } from '../inventory/index.ts'
import { coverageProblems, type Inventory, inventoryProblems, reasonProblems } from './inventory.ts'
import { realInterfaces } from './real-interfaces.ts'

const small: Inventory = {
  gestures: {
    'account.close': { web: 'closeAccountAction', mcp: 'manage_accounts · close' },
    'auth.sign-in': { web: 'screen:/login', mcp: { missingReason: 'OAuth sign-in is a web page.' } },
  },
  informations: {
    accounts: { web: 'screen:/accounts', mcp: 'manage_accounts · list' },
    'card-statements': { web: 'screen:/accounts/cards/[cardId]', mcp: 'manage_card_statements · list' },
  },
}

const real = {
  web: {
    elements: ['closeAccountAction', 'screen:/login', 'screen:/accounts', 'screen:/accounts/cards/[cardId]'],
  },
  mcp: {
    elements: ['manage_accounts · close', 'manage_accounts · list', 'manage_card_statements · list'],
    tools: ['manage_accounts', 'manage_card_statements'],
  },
}

const fullRun = [
  { driver: 'web', name: 'closeAccountAction' },
  { driver: 'web', name: 'screen:/login' },
  { driver: 'web', name: 'screen:/accounts' },
  { driver: 'web', name: 'screen:/accounts/cards/c-1' },
  { driver: 'mcp', name: 'manage_accounts', action: 'close' },
  { driver: 'mcp', name: 'manage_accounts', action: 'list' },
  { driver: 'mcp', name: 'manage_card_statements', action: 'list' },
]

test('an inventory matching the interfaces, with its reasons, and a run that exercised it all pass', () => {
  assert.deepEqual(inventoryProblems(small, real), [])
  assert.deepEqual(reasonProblems(small, ['web', 'mcp']), [])
  assert.deepEqual(coverageProblems(small, real, fullRun), [])
})

test('a gesture, then an information, offered on one side with no reason for the other is refused with interface_missing_without_reason', () => {
  const gesture: Inventory = {
    ...small,
    gestures: { ...small.gestures, 'account.reopen': { web: 'reopenAccountAction' } },
  }
  assert.deepEqual(reasonProblems(gesture, ['web', 'mcp']), [
    'interface_missing_without_reason gesture account.reopen: mcp neither offers it nor says why',
  ])
  const information: Inventory = {
    ...small,
    informations: { ...small.informations, overview: { mcp: 'get_overview' } },
  }
  assert.deepEqual(reasonProblems(information, ['web', 'mcp']), [
    'interface_missing_without_reason information overview: web neither offers it nor says why',
  ])
  const blank: Inventory = {
    ...small,
    gestures: { 'auth.sign-in': { web: 'screen:/login', mcp: { missingReason: '  ' } } },
  }
  assert.equal(reasonProblems(blank, ['web', 'mcp']).length, 1)
})

test('a third interface declared before the inventory knows it is refused on every entry, naming it', () => {
  const problems = reasonProblems(small, ['web', 'mcp', 'cli'])
  assert.equal(problems.length, 4)
  assert.ok(problems.every((p) => p.startsWith('interface_missing_without_reason') && p.includes(': cli ')))
})

test('a server action, a tool action or a screen missing from the inventory is refused with inventory_out_of_date', () => {
  const grown = {
    web: { elements: [...real.web.elements, 'deleteCardAction', 'screen:/analysis'] },
    mcp: { ...real.mcp, elements: [...real.mcp.elements, 'manage_accounts · reopen'] },
  }
  assert.deepEqual(inventoryProblems(small, grown), [
    'inventory_out_of_date web deleteCardAction is in no entry of the inventory',
    'inventory_out_of_date web screen:/analysis is in no entry of the inventory',
    'inventory_out_of_date mcp manage_accounts · reopen is in no entry of the inventory',
  ])
})

test('an entry naming what an interface no longer has is refused with inventory_out_of_date', () => {
  const shrunk = { ...real, web: { elements: real.web.elements.filter((e) => e !== 'closeAccountAction') } }
  assert.deepEqual(inventoryProblems(small, shrunk), [
    'inventory_out_of_date web closeAccountAction is in the inventory but the interface has no such thing',
  ])
})

test('a tool no case called is refused with mcp_tool_not_covered, a tool action with gesture_not_covered', () => {
  const withoutStatements = fullRun.filter((e) => e.name !== 'manage_card_statements')
  assert.deepEqual(coverageProblems(small, real, withoutStatements), [
    'gesture_not_covered mcp manage_card_statements · list',
    'mcp_tool_not_covered manage_card_statements',
  ])
  const withoutClose = fullRun.filter((e) => !(e.driver === 'mcp' && e.action === 'close'))
  assert.deepEqual(coverageProblems(small, real, withoutClose), [
    'gesture_not_covered mcp manage_accounts · close',
  ])
})

test('a server action or a screen no case reached is refused with gesture_not_covered', () => {
  const run = fullRun.filter(
    (e) => e.name !== 'closeAccountAction' && e.name !== 'screen:/accounts/cards/c-1',
  )
  assert.deepEqual(coverageProblems(small, real, run), [
    'gesture_not_covered web closeAccountAction',
    'gesture_not_covered web screen:/accounts/cards/[cardId]',
  ])
})

test('the inventory says, for every entry and both interfaces, what offers it or why not', () => {
  assert.deepEqual(reasonProblems({ gestures, informations }, driverNames()), [])
})

test('the inventory matches the interfaces as they are', async () => {
  assert.deepEqual(inventoryProblems({ gestures, informations }, await realInterfaces()), [])
})
