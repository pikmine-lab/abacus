import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A share comes back two ways: the refund stated on the claim itself, or an
// income declared as paying that expense back. Two identical shares, one per
// way, end in the same state: the same income written, the same remainder,
// the same net.
useCase('advances.share.refund-two-ways', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  for (const [payee, on] of [
    ['Le Zinc', '2026-06-03'],
    ['Chez Paul', '2026-06-04'],
  ] as const)
    await arrange.declareSharedExpense({
      account: 'Compte courant',
      amount: eur('90.00'),
      payee,
      on,
      shares: [{ debtor: 'Alex', amount: eur('30.00') }],
    })

  await act.refundShare({
    expense: { counterparty: 'Le Zinc', on: '2026-06-03' },
    debtor: 'Alex',
    amount: eur('20.00'),
    on: '2026-06-10',
  })
  await act.declareRefund({
    account: 'Compte courant',
    amount: eur('20.00'),
    debtor: 'Alex',
    on: '2026-06-10',
    refunds: { counterparty: 'Chez Paul', on: '2026-06-04' },
  })

  const claims = await act.readOpenClaims()
  assert.deepEqual(
    claims.sort((a, b) => a.expense.on.localeCompare(b.expense.on)),
    [
      { debtor: 'Alex', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('10.00') },
      { debtor: 'Alex', expense: { counterparty: 'Chez Paul', on: '2026-06-04' }, remaining: eur('10.00') },
    ],
  )
  assert.deepEqual(await act.readNetSpent({ payee: 'Le Zinc', month: '2026-06' }), eur('70.00'))
  assert.deepEqual(await act.readNetSpent({ payee: 'Chez Paul', month: '2026-06' }), eur('70.00'))
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('860.00'))
})
