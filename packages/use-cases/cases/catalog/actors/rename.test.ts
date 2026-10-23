import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('catalog.actor.rename', async ({ arrange, act }) => {
  await arrange.createActor('Boulangerie Martn')
  await act.editActor({ actor: 'Boulangerie Martn', name: 'Boulangerie Martin' })
  assert.deepEqual(await act.readActors(), [{ name: 'Boulangerie Martin', activity: null, aliases: [] }])
})
