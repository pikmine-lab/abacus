import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A share quoted in dollars: its price is read in euros, at the day's rate.
useCase('investments.price.refresh', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followInstrument({ query: 'acme', ticker: 'ACME', as: 'Acme' })
  await act.refreshPrices()
  assert.deepEqual(await act.readFollowedAssets(), [{ name: 'Acme', price: eur('154.80') }])
})
