import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.set-exceptions', async ({ arrange, act }) => {
  await arrange.createCategory({ name: 'Formation' })
  await arrange.createCategory({ name: 'Matériel' })
  await arrange.createCategory({ name: 'Restaurant' })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01' })
  await act.setActivityExceptions('Conseil', ['Matériel', 'Formation'])
  assert.deepEqual((await act.readActivity('Conseil')).exceptions, ['Formation', 'Matériel'])
})
