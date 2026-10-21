import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Asked before reattaching, the count of what would move, and since when;
// asking moves nothing.
useCase('catalog.actor.preview-reattach-history', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Atelier', kind: 'personal' })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('30.00'),
    payee: 'Imprimerie Dupont',
    on: '2026-06-03',
  })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('20.00'),
    payee: 'Imprimerie Dupont',
    on: '2026-06-10',
  })
  await arrange.editActor({ actor: 'Imprimerie Dupont', activity: 'Atelier' })
  assert.deepEqual(await act.previewReattachActorHistory('Imprimerie Dupont'), {
    movements: 2,
    since: '2026-06-03',
  })
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'activity', month: '2026-06' }), [
    { label: null, amount: eur('50.00') },
  ])
})
