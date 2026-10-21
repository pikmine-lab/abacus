import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('catalog.actor.attach-activity', async ({ arrange, act }) => {
  await arrange.createActivity({ name: 'Atelier', kind: 'personal' })
  await arrange.createActor('Imprimerie Dupont')
  await act.editActor({ actor: 'Imprimerie Dupont', activity: 'Atelier' })
  assert.deepEqual(await act.readActors(), [{ name: 'Imprimerie Dupont', activity: 'Atelier' }])
})
