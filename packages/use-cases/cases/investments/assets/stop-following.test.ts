import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.asset.stop-following', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followUnquotedAsset({ name: 'SCPI Pierre', nature: 'real_estate' })
  await arrange.followUnquotedAsset({ name: 'Parts Startup', nature: 'equity' })
  await act.stopFollowing('SCPI Pierre')
  assert.deepEqual(
    (await act.readFollowedAssets()).map((asset) => asset.name),
    ['Parts Startup'],
  )
})
