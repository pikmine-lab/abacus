import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// The gap is attributed to a payee the person already knows.
useCase('ledger.check-gap.settle', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Boulangerie Martin',
    on: '2026-06-10',
  })
  await arrange.recordBalanceCheck({ account: 'Compte courant', balance: eur('950.00') })
  await act.settleCheckGap({ account: 'Compte courant', on: '2026-06-15', actor: 'Boulangerie Martin' })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    { on: '2026-06-15', declared: eur('950.00'), computed: eur('987.50'), gap: eur('-37.50'), settled: true },
  ])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('950.00'))
})
