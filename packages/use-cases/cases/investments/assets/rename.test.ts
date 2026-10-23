import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.asset.rename', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followUnquotedAsset({ name: 'SCPI Pierre', nature: 'real_estate' })
  await act.renameAsset({ asset: 'SCPI Pierre', to: 'SCPI Rivoli' })
  assert.deepEqual(
    (await act.readFollowedAssets()).map((asset) => asset.name),
    ['SCPI Rivoli'],
  )
})
