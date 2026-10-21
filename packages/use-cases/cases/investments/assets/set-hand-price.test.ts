import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// What no source quotes is revalued by hand, on the day of the valuation.
useCase('investments.asset.set-hand-price', async ({ arrange, act }) => {
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
  await act.setAssetPrice({ asset: 'SCPI Rivage', price: eur('212.40'), on: '2026-05-31' })
  assert.deepEqual(await act.readPriceHistory('SCPI Rivage'), {
    days: 2,
    first: { on: '2026-01-31', price: eur('200.00') },
    last: { on: '2026-05-31', price: eur('212.40') },
  })
})
