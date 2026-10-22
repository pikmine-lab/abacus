import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// What the overview says beside the wealth: what the subscriptions cost a
// month, what waits to be confirmed, and an activity past one of its thresholds.
useCase('reporting.overview.what-to-do', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.createThreshold({
    activity: 'Conseil',
    label: 'Plafond micro',
    value: eur('1000.00'),
    consequence: 'Le régime micro cesse',
  })
  await arrange.declareIncome({
    account: 'Compte pro',
    amount: eur('1500.00'),
    payer: 'ACME',
    on: '2026-06-01',
  })
  await arrange.createSubscription({
    label: 'Logiciel',
    payee: 'Éditeur',
    account: 'Compte pro',
    amount: eur('30.00'),
    firstDueOn: '2026-06-01',
  })
  await arrange.createSubscription({
    label: 'Hébergement',
    payee: 'Hébergeur',
    account: 'Compte pro',
    amount: eur('12.00'),
    firstDueOn: '2026-07-01',
  })
  assert.deepEqual(await act.readCommittedMonthlyCost(), eur('42.00'))
  assert.equal(await act.readOccurrencesToConfirm(), 1)
  assert.deepEqual(await act.readThresholdAlerts(), [{ about: 'Plafond micro', state: 'crossed' }])
})
