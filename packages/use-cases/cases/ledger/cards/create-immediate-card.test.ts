import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.card.create-immediate', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.createCard({
    name: 'Carte bleue',
    account: 'Compte courant',
    expiry: '2027-03',
    debit: 'immediate',
  })
  assert.deepEqual(await act.readCards('Compte courant'), [
    { name: 'Carte bleue', expiry: '2027-03', debit: 'immediate' },
  ])
})
