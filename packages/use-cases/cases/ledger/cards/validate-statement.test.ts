import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.card-statement.validate', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createCard({
    name: 'Visa Premier',
    account: 'Compte courant',
    expiry: '2028-09',
    debit: 'deferred',
    cutOffDay: 25,
    debitDay: 31,
  })
  await arrange.declareCardPurchase({
    card: 'Visa Premier',
    amount: eur('40.00'),
    payee: 'Librairie Durand',
    on: '2026-05-10',
  })
  // Waiting for its debit, the purchase is in no balance.
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('1000.00'))
  await act.validateStatement({ card: 'Visa Premier', cutOff: '2026-05-25', debitedOn: '2026-06-01' })
  assert.deepEqual(await act.readCardStatements('Visa Premier'), [
    { cutOff: '2026-05-25', debitedOn: '2026-06-01', amount: eur('40.00') },
  ])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('960.00'))
})
