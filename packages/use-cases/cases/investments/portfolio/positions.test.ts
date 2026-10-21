import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A fund quoted in euros and a share quoted in dollars, read in euros at the
// day's rate, biggest holding first.
useCase('investments.portfolio.positions', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA', opening: eur('6000.00'), openedOn: '2026-05-01' })
  await arrange.followInstrument({ query: 'amundi world', ticker: 'WRLD.PA', as: 'Amundi World' })
  await arrange.followInstrument({ query: 'acme', ticker: 'ACME', as: 'Acme' })
  await arrange.recordOperation({
    account: 'PEA',
    type: 'buy',
    asset: 'Amundi World',
    quantity: '10',
    amount: eur('5000.00'),
    on: '2026-06-01',
  })
  await arrange.recordOperation({
    account: 'PEA',
    type: 'buy',
    asset: 'Acme',
    quantity: '5',
    amount: eur('700.00'),
    on: '2026-06-10',
  })
  assert.deepEqual(await act.readPositions(), [
    {
      asset: 'Amundi World',
      quantity: '10',
      averageCost: eur('500.00'),
      price: eur('520.00'),
      value: eur('5200.00'),
      gain: eur('200.00'),
    },
    {
      asset: 'Acme',
      quantity: '5',
      averageCost: eur('140.00'),
      price: eur('154.80'),
      value: eur('774.00'),
      gain: eur('74.00'),
    },
  ])
  assert.deepEqual(await act.readInvestmentAccounts(), [
    { account: 'PEA', cash: eur('300.00'), value: eur('6274.00') },
  ])
})
