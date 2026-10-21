import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// The money stays where it landed: only what it pays back changes, the
// expense being awaited again and the income counting as one.
useCase('ledger.movement.unlink-refund', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [{ debtor: 'Alex', amount: eur('30.00') }],
  })
  await arrange.declareRefund({
    account: 'Compte courant',
    amount: eur('30.00'),
    debtor: 'Alex',
    on: '2026-06-08',
    refunds: { counterparty: 'Le Zinc', on: '2026-06-03' },
  })
  await act.unlinkRefund({ counterparty: 'Alex', on: '2026-06-08' })
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('90.00'))
  assert.deepEqual(await act.readOpenClaims(), [
    { debtor: 'Alex', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('30.00') },
  ])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('940.00'))
})
