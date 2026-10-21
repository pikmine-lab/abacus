import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('identity.preferences.language', async ({ act }) => {
  await act.setLanguagePreference('en')
  assert.deepEqual(await act.readPreferences(), { reading: 'cash', rankingView: 'strip', language: 'en' })
  await act.setLanguagePreference(null)
  assert.deepEqual(await act.readPreferences(), { reading: 'cash', rankingView: 'strip', language: null })
})
