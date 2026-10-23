import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.balance-check.correct-note', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.recordBalanceCheck({ account: 'Compte courant', balance: eur('1000.00') })
  await act.correctBalanceCheck({
    account: 'Compte courant',
    on: '2026-06-15',
    balance: eur('1000.00'),
    note: 'Vérifié au guichet',
  })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    {
      on: '2026-06-15',
      declared: eur('1000.00'),
      computed: eur('1000.00'),
      gap: eur('0.00'),
      settled: false,
      note: 'Vérifié au guichet',
    },
  ])
})
