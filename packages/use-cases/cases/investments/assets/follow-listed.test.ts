import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.asset.follow-listed', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await act.followInstrument({ query: 'amundi world', ticker: 'WRLD.PA', as: 'Amundi World' })
  assert.deepEqual(
    (await act.readFollowedAssets()).map((asset) => asset.name),
    ['Amundi World'],
  )
})
