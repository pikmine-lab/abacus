import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('identity.preferences.ranking-view', async ({ act }) => {
  await act.setRankingViewPreference('bars')
  assert.deepEqual(await act.readPreferences(), { reading: 'cash', rankingView: 'bars', language: null })
})
