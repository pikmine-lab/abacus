import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// One claim per person and per thing advanced: a bill shared by two is two
// claims, each with what is left of it.
useCase('advances.share.open-claims', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.declareSharedExpense({
    account: 'Compte courant',
    amount: eur('90.00'),
    payee: 'Le Zinc',
    on: '2026-06-03',
    shares: [
      { debtor: 'Alex', amount: eur('30.00') },
      { debtor: 'Sam', amount: eur('20.00') },
    ],
  })
  await arrange.refundShare({
    expense: { counterparty: 'Le Zinc', on: '2026-06-03' },
    debtor: 'Sam',
    amount: eur('5.00'),
    on: '2026-06-08',
  })
  const claims = await act.readOpenClaims()
  assert.deepEqual(
    claims.sort((a, b) => a.debtor.localeCompare(b.debtor)),
    [
      { debtor: 'Alex', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('30.00') },
      { debtor: 'Sam', expense: { counterparty: 'Le Zinc', on: '2026-06-03' }, remaining: eur('15.00') },
    ],
  )
})
