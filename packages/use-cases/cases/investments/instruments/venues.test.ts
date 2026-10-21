import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.instrument.venues', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  assert.deepEqual(await act.readVenuesOf('amundi world'), [
    { ticker: 'WRLD.PA', venue: 'Paris', price: { amount: '520.00', currency: 'EUR' } },
    { ticker: 'WRLD.DE', venue: 'XETRA', price: { amount: '520.50', currency: 'EUR' } },
  ])
})
