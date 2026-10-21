import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('catalog.actor.merge', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.00'),
    payee: "McDonald's",
    on: '2026-06-03',
  })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('8.00'),
    payee: 'Mc Do',
    on: '2026-06-05',
  })
  await act.mergeActors({ keep: "McDonald's", absorb: 'Mc Do' })
  assert.deepEqual(await act.readActors(), [{ name: "McDonald's", activity: null }])
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'actor', month: '2026-06' }), [
    { label: "McDonald's", amount: eur('20.00') },
  ])
})
