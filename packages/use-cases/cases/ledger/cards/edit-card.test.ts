import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.card.edit', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createCard({
    name: 'Carte bleue',
    account: 'Compte courant',
    expiry: '2026-08',
    debit: 'immediate',
  })
  // The card was renewed: a new expiry, and the name the person gives it now.
  await act.editCard({ card: 'Carte bleue', name: 'Carte bleue 2029', expiry: '2029-08' })
  assert.deepEqual(await act.readCards('Compte courant'), [
    { name: 'Carte bleue 2029', expiry: '2029-08', debit: 'immediate' },
  ])
})
