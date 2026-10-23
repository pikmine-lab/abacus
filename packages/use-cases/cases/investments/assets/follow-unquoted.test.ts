import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.asset.follow-unquoted', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await act.followUnquotedAsset({ name: 'SCPI Pierre', nature: 'real_estate' })
  assert.deepEqual(await act.readFollowedAssets(), [{ name: 'SCPI Pierre', price: null }])
})
