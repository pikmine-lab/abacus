import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('catalog.actor.create', async ({ act }) => {
  await act.createActor('Boulangerie Martin')
  assert.deepEqual(await act.readActors(), [{ name: 'Boulangerie Martin', activity: null }])
})
