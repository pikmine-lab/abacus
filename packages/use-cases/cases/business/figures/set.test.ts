import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('business.figure.set', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await act.setActivityFigure('Conseil', { name: 'base_choisie', validFrom: '2026-01-01', value: '12000' })
  assert.deepEqual(await act.readActivityFigures('Conseil'), [
    { name: 'base_choisie', validFrom: '2026-01-01', value: '12000' },
  ])
})
