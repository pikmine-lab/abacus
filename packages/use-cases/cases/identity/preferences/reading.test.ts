import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('identity.preferences.reading', async ({ act }) => {
  assert.deepEqual(await act.readPreferences(), { reading: 'cash', rankingView: 'strip', language: null })
  await act.setReadingPreference('accrual')
  assert.deepEqual(await act.readPreferences(), { reading: 'accrual', rankingView: 'strip', language: null })
})
