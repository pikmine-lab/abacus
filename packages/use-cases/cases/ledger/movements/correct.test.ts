import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.movement.correct', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Boulangerie Martin',
    on: '2026-06-10',
  })
  await act.correctMovementAmount({
    movement: { counterparty: 'Boulangerie Martin', on: '2026-06-10' },
    amount: eur('15.00'),
  })
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('985.00'))
})
