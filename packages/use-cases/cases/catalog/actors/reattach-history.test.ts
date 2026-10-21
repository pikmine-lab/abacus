import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Attaching an activity to an actor leaves its past movements where they
// were; reattaching its history brings them under the activity.
useCase('catalog.actor.reattach-history', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Atelier', kind: 'personal' })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('30.00'),
    payee: 'Imprimerie Dupont',
    on: '2026-06-03',
  })
  await arrange.editActor({ actor: 'Imprimerie Dupont', activity: 'Atelier' })
  await act.reattachActorHistory('Imprimerie Dupont')
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'activity', month: '2026-06' }), [
    { label: 'Atelier', amount: eur('30.00') },
  ])
})
