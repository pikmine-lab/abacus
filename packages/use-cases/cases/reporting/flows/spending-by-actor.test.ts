import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('reporting.flows.spending-by-actor', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('2000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('40.00'),
    payee: 'Le Bistrot',
    on: '2026-06-03',
  })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('60.00'),
    payee: 'Carrefour',
    on: '2026-06-05',
  })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('25.00'),
    payee: 'Le Bistrot',
    on: '2026-06-12',
  })
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'actor', month: '2026-06' }), [
    { label: 'Le Bistrot', amount: eur('65.00') },
    { label: 'Carrefour', amount: eur('60.00') },
  ])
})
