import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// An account is closed on the day it really was, which is not always the day it is said.
useCase('ledger.account.close-on-a-day', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Livret ancien', opening: eur('0.00') })
  await act.closeAccount('Livret ancien', '2026-06-01')
  assert.deepEqual(await act.readAccount('Livret ancien'), {
    balance: eur('0.00'),
    closed: true,
    closedOn: '2026-06-01',
  })
})
