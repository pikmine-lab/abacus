import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.card.create-deferred', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.createCard({
    name: 'Visa Premier',
    account: 'Compte courant',
    expiry: '2028-09',
    debit: 'deferred',
    cutOffDay: 25,
    debitDay: 31,
  })
  assert.deepEqual(await act.readCards('Compte courant'), [
    { name: 'Visa Premier', expiry: '2028-09', debit: 'deferred', cutOffDay: 25, debitDay: 31 },
  ])
})
