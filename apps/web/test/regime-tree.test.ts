import assert from 'node:assert/strict'
import test from 'node:test'
import type { RegimeQuestion } from '@abacus/core/domain/regime'
import { answered, answersOf, keepMeaningful } from '../src/lib/regime-tree.ts'

/**
 * Walking back in the questionnaire. The engine takes the answers as the whole
 * state, so what the screen sends it has to be a state that could have been
 * reached by asking: an answer to a question the tree would no longer put is
 * not one, and it would be read all the same.
 */

const vat: RegimeQuestion = {
  id: 'vat',
  label: 'Facturez-vous la TVA ?',
  options: [
    { value: 'franchise', label: 'Non' },
    { value: 'charged', label: 'Oui' },
  ],
}

const rate: RegimeQuestion = {
  id: 'vat_rate',
  label: 'À quel taux ?',
  when: { vat: ['charged'] },
  options: [
    { value: 'standard', label: '20 %' },
    { value: 'reduced', label: '5,5 %' },
  ],
}

const nature: RegimeQuestion = {
  id: 'activity_nature',
  label: 'Quelle nature ?',
  options: [
    { value: 'sale', label: 'Vente' },
    { value: 'services', label: 'Services' },
  ],
}

test('a trail nothing contradicts is kept whole', () => {
  const trail = answered(answered([], vat, 'charged'), rate, 'standard')
  assert.deepEqual(answersOf(trail), { vat: 'charged', vat_rate: 'standard' })
})

test('an answer whose question no longer applies is forgotten', () => {
  const trail = answered(answered([], vat, 'charged'), rate, 'standard')
  const back = answered(trail, vat, 'franchise')
  assert.deepEqual(answersOf(back), { vat: 'franchise' })
})

test('answering a question again replaces it where it stands', () => {
  const trail = answered(answered(answered([], nature, 'sale'), vat, 'charged'), rate, 'standard')
  const back = answered(trail, nature, 'services')
  assert.deepEqual(
    back.map((s) => s.question.id),
    ['activity_nature', 'vat', 'vat_rate'],
  )
  assert.deepEqual(answersOf(back), {
    activity_nature: 'services',
    vat: 'charged',
    vat_rate: 'standard',
  })
})

test('an answer to a question never asked is refused entry', () => {
  const trail = keepMeaningful([{ question: rate, value: 'standard' }])
  assert.deepEqual(trail, [])
})

test('an answer given again is not duplicated', () => {
  const trail = answered(answered([], vat, 'charged'), vat, 'franchise')
  assert.equal(trail.length, 1)
  assert.deepEqual(answersOf(trail), { vat: 'franchise' })
})
