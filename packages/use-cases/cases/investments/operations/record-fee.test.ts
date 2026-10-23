import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('investments.operation.record-fee', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'CTO', opening: eur('1000.00'), openedOn: '2026-05-01' })
  await arrange.followInstrument({ query: 'acme', ticker: 'ACME', as: 'Acme' })
  await arrange.recordOperation({
    account: 'CTO',
    type: 'buy',
    asset: 'Acme',
    quantity: '5',
    amount: eur('700.00'),
    on: '2026-06-01',
  })
  await act.recordOperation({ account: 'CTO', type: 'fee', amount: eur('4.00'), on: '2026-06-12' })
  assert.deepEqual(await act.readOperations(), [
    { type: 'fee', amount: eur('4.00'), on: '2026-06-12' },
    { type: 'buy', asset: 'Acme', quantity: '5', amount: eur('700.00'), on: '2026-06-01' },
  ])
  assert.deepEqual(await act.readInvestmentAccounts(), [
    { account: 'CTO', cash: eur('296.00'), value: eur('1070.00') },
  ])
})
