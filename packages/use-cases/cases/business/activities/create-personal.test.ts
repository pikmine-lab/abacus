import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.create-personal', async ({ act }) => {
  await act.createActivity({ name: 'Location meublée', kind: 'personal' })
  const activity = await act.readActivity('Location meublée')
  assert.deepEqual({ kind: activity.kind, closedOn: activity.closedOn }, { kind: 'personal', closedOn: null })
})
