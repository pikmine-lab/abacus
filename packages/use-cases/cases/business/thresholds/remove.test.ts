import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('business.threshold.remove', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.createThreshold({
    activity: 'Conseil',
    label: 'Plafond micro',
    value: eur('77700.00'),
    consequence: 'Le régime micro cesse',
  })
  await act.removeThreshold('Conseil', 'Plafond micro')
  assert.deepEqual(await act.readThresholds('Conseil'), [])
})
