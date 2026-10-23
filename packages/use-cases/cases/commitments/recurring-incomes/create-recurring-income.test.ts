import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.recurring-income.create', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.createRecurringIncome({
    label: 'Salaire',
    payer: 'Atelier Durand',
    account: 'Compte courant',
    amount: eur('2500.00'),
    firstDueOn: '2026-06-28',
  })
  assert.deepEqual(await act.readCommitment('Salaire'), {
    account: 'Compte courant',
    amount: eur('2500.00'),
    nextDueOn: '2026-06-28',
  })
})
