import assert from 'node:assert/strict'
import test from 'node:test'
import { negotiateLanguage } from './config.ts'

test('the browser is followed in its own order of preference', () => {
  assert.equal(negotiateLanguage('en-US,en;q=0.9,fr;q=0.8'), 'en')
  assert.equal(negotiateLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr')
  assert.equal(negotiateLanguage('fr;q=0.5,en;q=0.9'), 'en')
})

test('a regional variant is served by its language', () => {
  assert.equal(negotiateLanguage('en-GB'), 'en')
})

test('a language the interface does not speak is skipped, not guessed', () => {
  assert.equal(negotiateLanguage('de-DE,de;q=0.9,en;q=0.5'), 'en')
  assert.equal(negotiateLanguage('de-DE,es;q=0.9'), undefined)
  assert.equal(negotiateLanguage('en;q=0,fr;q=0.1'), 'fr')
  assert.equal(negotiateLanguage(null), undefined)
})
