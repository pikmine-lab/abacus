import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A check is recorded on the day the person reads the bank: the suite's day.
useCase('ledger.balance-check.record', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Boulangerie Martin',
    on: '2026-06-10',
  })
  await act.recordBalanceCheck({ account: 'Compte courant', balance: eur('950.00') })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    {
      on: '2026-06-15',
      declared: eur('950.00'),
      computed: eur('987.50'),
      gap: eur('-37.50'),
      settled: false,
    },
  ])
})
