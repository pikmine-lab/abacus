import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.instrument.search-known', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  assert.deepEqual(await act.searchInstruments('amundi world'), [
    {
      name: 'Amundi MSCI World UCITS ETF Acc',
      ticker: 'WRLD.PA',
      price: { amount: '520.00', currency: 'EUR' },
    },
  ])
  assert.deepEqual(await act.searchInstruments('bitcoin'), [
    { name: 'Bitcoin', ticker: 'bitcoin', price: { amount: '60000.00', currency: 'EUR' } },
  ])
})
