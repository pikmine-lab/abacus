import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('business.figure.remove', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.setActivityFigure('Conseil', {
    name: 'base_choisie',
    validFrom: '2026-01-01',
    value: '12000',
  })
  await arrange.setActivityFigure('Conseil', {
    name: 'base_choisie',
    validFrom: '2026-04-01',
    value: '15000',
  })
  await act.removeActivityFigure('Conseil', { name: 'base_choisie', validFrom: '2026-01-01' })
  assert.deepEqual(await act.readActivityFigures('Conseil'), [
    { name: 'base_choisie', validFrom: '2026-04-01', value: '15000' },
  ])
})
