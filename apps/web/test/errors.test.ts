import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { LANGUAGES } from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import { listJurisdictions, previewRegime, questionnaire } from '@abacus/core/services/regimes'

/**
 * A refusal reaches the person as a sentence, not as a code, in every language
 * the interface speaks. The codes below are taken from the service itself
 * rather than typed from memory: a code that gets renamed there fails here
 * instead of silently showing the domain's English message on screen.
 */

const catalogs = LANGUAGES.map((language) => ({
  language,
  messages: JSON.parse(
    readFileSync(new URL(`../src/i18n/messages/${language}/errors.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>,
}))

function assertSentences(codes: string[]) {
  for (const { language, messages } of catalogs)
    for (const code of codes) assert.ok(messages[code], `no ${language} message for ${code}`)
}

function refusalOf(gesture: () => unknown): string {
  try {
    gesture()
  } catch (e) {
    assert.ok(e instanceof DomainError, `expected a DomainError, got ${e}`)
    return e.code
  }
  return assert.fail('expected a refusal')
}

test('the refusals of the questionnaire have a sentence', () => {
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
  assertSentences(codes)
})

test('applying a regime refuses with a sentence too', () => {
  assertSentences([
    'regime_answers_incomplete',
    'regime_model_excluded',
    'activity_exists',
    'vat_rate_needs_registration',
  ])
})

test('a zero return refuses with a sentence too', () => {
  assertSentences([
    'levy_files_no_return',
    'levy_period_running',
    'levy_amount_unknown',
    'levy_due_not_nil',
    'nil_return_not_found',
  ])
})

test('a card refuses with a sentence too', () => {
  assertSentences([
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
    'card_needs_expense',
    'statement_not_found',
    'statement_debit_ahead',
    'statement_debit_before_cut_off',
  ])
})

test('no message is left as its own code', () => {
  for (const { language, messages } of catalogs)
    for (const [code, message] of Object.entries(messages)) {
      assert.ok(message.length > 0, `${code} has an empty ${language} message`)
      assert.ok(!message.includes('_'), `${code} shows a code rather than a sentence in ${language}`)
    }
})
