import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.balance-check.delete', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.recordBalanceCheck({ account: 'Compte courant', balance: eur('900.00') })
  await act.deleteBalanceCheck({ account: 'Compte courant', on: '2026-06-15' })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [])
})
