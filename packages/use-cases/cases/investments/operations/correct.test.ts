import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('investments.operation.correct', async ({ arrange, act }) => {
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
  await act.correctOperation(
    { type: 'buy', asset: 'Amundi World', on: '2026-06-01' },
    { amount: eur('4800.00'), quantity: '9', on: '2026-06-02' },
  )
  assert.deepEqual(await act.readOperations(), [
    { type: 'buy', asset: 'Amundi World', quantity: '9', amount: eur('4800.00'), on: '2026-06-02' },
  ])
  assert.deepEqual(await act.readPositions(), [
    {
      asset: 'Amundi World',
      quantity: '9',
      averageCost: eur('533.33'),
      price: eur('520.00'),
      value: eur('4680.00'),
      gain: eur('-120.00'),
    },
  ])
})
