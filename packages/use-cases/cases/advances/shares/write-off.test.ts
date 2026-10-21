import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Written off, the claim is no longer awaited, and the expense stays whole:
// its net deducts what came back, nothing more.
useCase('advances.share.write-off', async ({ arrange, act }) => {
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

  await act.writeOffShare(share)
  assert.deepEqual(await act.readOpenClaims(), [])
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('80.00'))
})
