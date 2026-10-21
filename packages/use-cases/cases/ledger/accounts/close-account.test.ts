import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.account.close', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Livret ancien', opening: eur('0.00') })
  await act.closeAccount('Livret ancien')
  assert.deepEqual(await act.readAccount('Livret ancien'), { balance: eur('0.00'), closed: true })
})
