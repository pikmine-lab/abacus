import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('reporting.flows.spending-by-category', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('2000.00') })
  await arrange.createCategory({ name: 'Restaurants', group: 'Vie courante' })
  await arrange.createCategory({ name: 'Courses', group: 'Vie courante' })
  await arrange.createCategory({ name: 'Loyer' })
  const spend = async (payee: string, amount: string, on: string, category?: string) => {
    await arrange.declareExpense({ account: 'Compte courant', amount: eur(amount), payee, on })
    if (category) await arrange.fileMovement({ movement: { counterparty: payee, on }, category })
  }
  await spend('SCI Bleue', '700.00', '2026-06-01', 'Loyer')
  await spend('Le Bistrot', '40.00', '2026-06-03', 'Restaurants')
  await spend('Carrefour', '60.00', '2026-06-05', 'Courses')
  await spend('Kiosque', '5.00', '2026-06-07')
  // Another month: outside the one read.
  await spend('Carrefour', '90.00', '2026-05-20', 'Courses')
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'category', month: '2026-06' }), [
    { label: 'Loyer', amount: eur('700.00') },
    { label: 'Courses', amount: eur('60.00') },
    { label: 'Restaurants', amount: eur('40.00') },
    { label: null, amount: eur('5.00') },
  ])
})
