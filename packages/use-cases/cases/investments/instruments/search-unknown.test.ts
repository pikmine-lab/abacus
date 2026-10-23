import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('investments.instrument.search-unknown', async ({ arrange, act }) => {
  await arrange.createInvestmentAccount({ name: 'PEA' })
  assert.deepEqual(await act.searchInstruments('zzzz'), [])
})
