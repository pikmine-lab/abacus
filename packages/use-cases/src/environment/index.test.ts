import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { realInterfaces } from '../guards/real-interfaces.ts'
import { gestures, informations, offeringsOf } from '../inventory/index.ts'
import { serverEnvironment } from './index.ts'

/** The suite's end, run alone on a folder of records: its exit code and what it wrote. */
function teardownOn(records: object[], coverage: string | undefined) {
  const folder = mkdtempSync(`${tmpdir()}/abacus-records-`)
  writeFileSync(`${folder}/1.jsonl`, records.map((r) => `${JSON.stringify(r)}\n`).join(''))
  // Without the variable through which node:test drives its own children.
  const { NODE_TEST_CONTEXT: _, ABACUS_CASES_COVERAGE: __, ...env } = process.env
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await (await import(${JSON.stringify(import.meta.resolve('./index.ts'))})).globalTeardown()`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...env,
        ABACUS_CASES_EXERCISED: folder,
        ...(coverage ? { ABACUS_CASES_COVERAGE: coverage } : {}),
      },
    },
  )
  return { status: run.status, stderr: run.stderr }
}

/** A record of everything the inventory lists and every tool, as a full run leaves it. */
async function fullRecord(): Promise<object[]> {
  const real = await realInterfaces()
  return Object.entries(real).flatMap(([driver, { tools }]) => [
    ...[...Object.values(gestures), ...Object.values(informations)].flatMap((entry) =>
      offeringsOf(entry, driver).map((offering) => {
        const [name, action] = offering.split(' · ')
        return { driver, name, ...(action ? { action } : {}) }
      }),
    ),
    ...(tools ?? []).map((name) => ({ driver, name })),
  ])
}

test('the end of a full run fails, naming what is missing, when a record lacks a tool', async () => {
  const lacking = (await fullRecord()).filter((r) => !('name' in r && r.name === 'get_balance_history'))
  const run = teardownOn(lacking, '1')
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /mcp_tool_not_covered get_balance_history/)
})

test('the end of a full run passes on a complete record', async () => {
  assert.equal(teardownOn(await fullRecord(), '1').status, 0)
})

test('the end of a run narrowed to some cases does not judge the coverage', () => {
  assert.equal(teardownOn([], undefined).status, 0)
})

test('a server the suite serves is cut from the outside network, as the tests are', () => {
  const env = serverEnvironment({
    databaseUrl: 'postgres://x',
    webUrl: 'http://127.0.0.1:1',
    mcpUrl: 'http://127.0.0.1:2/mcp',
  })
  const { NODE_TEST_CONTEXT: _, NODE_OPTIONS: __, ...inherited } = process.env
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "try { await fetch('http://example.com/') } catch (e) { console.log((e.cause ?? e).code) }",
    ],
    { encoding: 'utf8', env: { ...inherited, NODE_OPTIONS: env.NODE_OPTIONS } },
  )
  assert.equal(run.stdout.trim(), 'outside_network_blocked')
})
