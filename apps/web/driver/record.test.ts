import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { actionNames, actionOf, screenOf } from './record.ts'

test('a request carrying a server action id names the action the build exported under it', () => {
  const folder = mkdtempSync(`${tmpdir()}/abacus-manifest-`)
  writeFileSync(
    `${folder}/server-reference-manifest.json`,
    JSON.stringify({
      node: {
        '40ab': { workers: {}, filename: 'apps/web/src/lib/actions.ts', exportedName: 'closeAccountAction' },
        '40cd': { workers: {}, filename: 'apps/web/src/lib/actions.ts' },
      },
      edge: {},
    }),
  )
  const names = actionNames(`${folder}/server-reference-manifest.json`)
  assert.equal(actionOf({ 'next-action': '40ab', accept: 'text/x-component' }, names), 'closeAccountAction')
  assert.equal(actionOf({ 'next-action': '40ff' }, names), undefined)
  assert.equal(actionOf({ accept: 'text/html' }, names), undefined)
})

test('a page of the served app is the screen of its path, without its query', () => {
  assert.equal(screenOf('http://127.0.0.1:3000/'), 'screen:/')
  assert.equal(screenOf('http://127.0.0.1:3000/accounts?from=home'), 'screen:/accounts')
  assert.equal(screenOf('http://127.0.0.1:3000/accounts/cards/c-1/'), 'screen:/accounts/cards/c-1')
})
