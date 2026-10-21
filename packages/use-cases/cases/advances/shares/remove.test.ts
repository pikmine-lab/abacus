import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Removing a share that something came back on: the money stays, as a plain
// income, so the expense is whole again in its net.
useCase('advances.share.remove', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [{ debtor: 'Alex', amount: eur('30.00') }],
  })
  const share = { expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, debtor: 'Alex' }
  await arrange.refundShare({ ...share, amount: eur('10.00'), on: '2026-06-08' })

  await act.removeShare(share)
  assert.deepEqual(await act.readOpenClaims(), [])
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('90.00'))
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('920.00'))
})
