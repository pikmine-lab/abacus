import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.balance-check.correct', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Boulangerie Martin',
    on: '2026-06-10',
  })
  await arrange.recordBalanceCheck({ account: 'Compte courant', balance: eur('978.50') })
  // The balance was misread: it was 987,50, the books were right.
  await act.correctBalanceCheck({ account: 'Compte courant', on: '2026-06-15', balance: eur('987.50') })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    { on: '2026-06-15', declared: eur('987.50'), computed: eur('987.50'), gap: eur('0.00'), settled: false },
  ])
})
