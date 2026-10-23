import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A balance read on an earlier day is set against what the books said that day.
useCase('ledger.balance-check.record-on-a-day', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Boulangerie Martin',
    on: '2026-06-10',
  })
  await act.recordBalanceCheck({ account: 'Compte courant', balance: eur('1000.00'), on: '2026-06-05' })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    {
      on: '2026-06-05',
      declared: eur('1000.00'),
      computed: eur('1000.00'),
      gap: eur('0.00'),
      settled: false,
    },
  ])
})
