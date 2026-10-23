import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.close', async ({ arrange, act }) => {
  await arrange.createActivity({ name: 'Conseil', startedOn: '2025-01-01' })
  await act.closeActivity('Conseil', '2026-03-31')
  assert.equal((await act.readActivity('Conseil')).closedOn, '2026-03-31')
})
