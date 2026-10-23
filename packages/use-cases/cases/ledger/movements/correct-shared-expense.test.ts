import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Correcting an advanced expense keeps what is owed on it.
useCase('ledger.movement.correct-shared-expense', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [{ debtor: 'Alex', amount: eur('30.00') }],
  })
  await act.correctMovementAmount({
    movement: { counterparty: 'Le Zinc', on: '2026-06-03' },
    amount: eur('120.00'),
  })
  assert.deepEqual(await act.readOpenClaims(), [
    { debtor: 'Alex', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('30.00') },
  ])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('880.00'))
})
