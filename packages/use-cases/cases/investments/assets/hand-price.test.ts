import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('investments.asset.read-hand-price', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followUnquotedAsset({ name: 'SCPI Pierre', nature: 'real_estate' })
  await arrange.setAssetPrice({ asset: 'SCPI Pierre', price: eur('250.00'), on: '2026-06-01' })
  assert.deepEqual(await act.readFollowedAssets(), [{ name: 'SCPI Pierre', price: eur('250.00') }])
})
