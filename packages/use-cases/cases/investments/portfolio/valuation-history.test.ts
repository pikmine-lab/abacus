import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// One information, read as a curve by one interface and as its conclusions by
// another: the same values at both ends of the window (C49).
useCase('investments.portfolio.valuation-history', async ({ arrange, act }) => {
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
  assert.deepEqual(await act.readValuationHistory(), {
    first: {
      on: '2026-06-01',
      value: eur('6200.00'),
      contributions: eur('6000.00'),
      performance: eur('200.00'),
    },
    last: {
      on: '2026-06-15',
      value: eur('6274.00'),
      contributions: eur('6000.00'),
      performance: eur('274.00'),
    },
  })
})
