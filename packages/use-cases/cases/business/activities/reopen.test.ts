import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.reopen', async ({ arrange, act }) => {
  await arrange.createActivity({ name: 'Conseil', startedOn: '2025-01-01' })
  await arrange.closeActivity('Conseil', '2026-03-31')
  await act.reopenActivity('Conseil')
  assert.equal((await act.readActivity('Conseil')).closedOn, null)
})
