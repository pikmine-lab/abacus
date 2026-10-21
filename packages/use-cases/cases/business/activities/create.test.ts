import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.create', async ({ act }) => {
  await act.createActivity({ name: 'Conseil', startedOn: '2026-01-01', regimeLabel: 'Micro-entreprise' })
  assert.deepEqual(await act.readActivity('Conseil'), {
    name: 'Conseil',
    kind: 'business',
    regimeLabel: 'Micro-entreprise',
    closedOn: null,
    accounts: [],
    exceptions: [],
  })
})
