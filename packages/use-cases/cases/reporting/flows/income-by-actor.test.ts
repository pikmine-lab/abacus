import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('reporting.flows.income-by-actor', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('100.00') })
  await arrange.declareIncome({
    account: 'Compte courant',
    amount: eur('2500.00'),
    payer: 'Acme SA',
    on: '2026-06-01',
  })
  await arrange.declareIncome({
    account: 'Compte courant',
    amount: eur('150.00'),
    payer: 'CAF',
    on: '2026-06-05',
  })
  // Spending is the other side: it is not read here.
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('40.00'),
    payee: 'Le Bistrot',
    on: '2026-06-03',
  })
  assert.deepEqual(await act.readFlows({ kind: 'income', by: 'actor', month: '2026-06' }), [
    { label: 'Acme SA', amount: eur('2500.00') },
    { label: 'CAF', amount: eur('150.00') },
  ])
})
