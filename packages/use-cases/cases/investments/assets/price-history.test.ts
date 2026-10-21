import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Every price typed by hand stays in the history of the holding.
useCase('investments.asset.price-history', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA', opening: eur('1000.00'), openedOn: '2026-01-01' })
  await arrange.followUnquotedAsset({ name: 'SCPI Rivage', nature: 'real_estate' })
  await arrange.recordOperation({
    account: 'PEA',
    type: 'buy',
    asset: 'SCPI Rivage',
    quantity: '2',
    amount: eur('400.00'),
    on: '2026-02-01',
  })
  await arrange.setAssetPrice({ asset: 'SCPI Rivage', price: eur('200.00'), on: '2026-01-31' })
  await arrange.setAssetPrice({ asset: 'SCPI Rivage', price: eur('205.00'), on: '2026-03-31' })
  await arrange.setAssetPrice({ asset: 'SCPI Rivage', price: eur('210.50'), on: '2026-05-31' })
  assert.deepEqual(await act.readPriceHistory('SCPI Rivage'), {
    days: 3,
    first: { on: '2026-01-31', price: eur('200.00') },
    last: { on: '2026-05-31', price: eur('210.50') },
  })
})
