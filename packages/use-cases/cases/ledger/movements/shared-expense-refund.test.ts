import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A net only deducts money that moved: the refund awaited is said beside the
// net, and only the refund received lowers it. Amounts in whole euros, the
// precision every interface reads a net at.
useCase('ledger.movement.shared-expense-refund', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [{ debtor: 'Alex', amount: eur('30.00') }],
  })
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('90.00'))
  assert.deepEqual(await act.readOpenClaims(), [
    { debtor: 'Alex', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('30.00') },
  ])

  await act.declareRefund({
    account: 'Compte courant',
    amount: eur('30.00'),
    debtor: 'Alex',
    on: '2026-06-08',
    refunds: { counterparty: 'Le Zinc', on: '2026-06-03' },
  })
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('60.00'))
  assert.deepEqual(await act.readOpenClaims(), [])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('940.00'))
})
