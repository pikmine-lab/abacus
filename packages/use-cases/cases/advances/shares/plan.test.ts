import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('advances.share.plan', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [{ debtor: 'Alex', amount: eur('30.00') }],
  })
  await act.planShare({
    expense: { counterparty: 'Le Zinc', on: '2026-06-03' },
    debtor: 'Alex',
    count: 3,
    firstDueOn: '2026-07-01',
  })
  assert.deepEqual(await act.readOpenClaims(), [
    {
      debtor: 'Alex',
      expense: { counterparty: 'Le Zinc', on: '2026-06-03' },
      remaining: eur('30.00'),
      nextDue: { on: '2026-07-01', amount: eur('10.00') },
    },
  ])
})
