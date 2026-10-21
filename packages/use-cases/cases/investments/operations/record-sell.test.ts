import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('investments.operation.record-sell', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA', opening: eur('6000.00'), openedOn: '2026-05-01' })
  await arrange.followInstrument({ query: 'amundi world', ticker: 'WRLD.PA', as: 'Amundi World' })
  await arrange.recordOperation({
    account: 'PEA',
    type: 'buy',
    asset: 'Amundi World',
    quantity: '10',
    amount: eur('5000.00'),
    on: '2026-06-01',
  })
  await act.recordOperation({
    account: 'PEA',
    type: 'sell',
    asset: 'Amundi World',
    quantity: '4',
    amount: eur('2080.00'),
    on: '2026-06-12',
  })
  assert.deepEqual(await act.readPositions(), [
    {
      asset: 'Amundi World',
      quantity: '6',
      averageCost: eur('500.00'),
      price: eur('520.00'),
      value: eur('3120.00'),
      gain: eur('120.00'),
    },
  ])
  assert.deepEqual(await act.readInvestmentAccounts(), [
    { account: 'PEA', cash: eur('3080.00'), value: eur('6200.00') },
  ])
})
