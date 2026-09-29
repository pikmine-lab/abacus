import assert from 'node:assert/strict'
import test from 'node:test'
import { DomainError } from '@abacus/core/domain/errors'
import { listJurisdictions, previewRegime, questionnaire } from '@abacus/core/services/regimes'
import { FR } from '../src/lib/fr-errors.ts'

/**
 * A refusal reaches the person as a sentence, not as a code. The codes below
 * are taken from the service itself rather than typed from memory: a code that
 * gets renamed there fails here instead of silently showing English on screen.
 */

function refusalOf(gesture: () => unknown): string {
  try {
    gesture()
  } catch (e) {
    assert.ok(e instanceof DomainError, `expected a DomainError, got ${e}`)
    return e.code
  }
  return assert.fail('expected a refusal')
}

test('the refusals of the questionnaire speak French', () => {
  const [jurisdiction] = listJurisdictions()
  assert.ok(jurisdiction, 'the catalog ships at least one jurisdiction')
  const first = questionnaire(jurisdiction.id).question
  assert.ok(first, 'a jurisdiction opens on a question')

  const codes = [
    refusalOf(() => questionnaire('nowhere-at-all')),
    refusalOf(() => previewRegime('no-such-model')),
    refusalOf(() => questionnaire(jurisdiction.id, { [first.id]: 'not-an-option' })),
  ]
  assert.deepEqual(codes, ['jurisdiction_not_found', 'regime_model_not_found', 'regime_answer_unknown'])
  for (const code of codes) assert.ok(FR[code], `no French message for ${code}`)
})

test('applying a regime refuses in French too', () => {
  for (const code of [
    'regime_answers_incomplete',
    'regime_model_excluded',
    'activity_exists',
    'vat_rate_needs_registration',
  ])
    assert.ok(FR[code], `no French message for ${code}`)
})

test('a zero return refuses in French too', () => {
  for (const code of [
    'levy_files_no_return',
    'levy_period_running',
    'levy_amount_unknown',
    'levy_due_not_nil',
    'nil_return_not_found',
  ])
    assert.ok(FR[code], `no French message for ${code}`)
})

test('a card refuses in French too', () => {
  for (const code of [
    'card_not_found',
    'card_exists',
    'card_needs_payment_account',
    'schedule_on_immediate',
    'deferred_needs_schedule',
    'card_in_use',
    'card_other_account',
    'card_expired',
    'transfer_has_no_card',
    'refund_has_no_card',
    'card_on_subscription',
    'statement_not_found',
    'statement_debit_ahead',
    'statement_debit_before_cut_off',
  ])
    assert.ok(FR[code], `no French message for ${code}`)
})

test('no message is left as its own code', () => {
  for (const [code, message] of Object.entries(FR)) {
    assert.ok(message.length > 0, `${code} has an empty message`)
    assert.ok(!message.includes('_'), `${code} shows a code rather than a sentence`)
  }
})
