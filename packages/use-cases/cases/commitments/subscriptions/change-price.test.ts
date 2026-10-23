import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.subscription.change-price', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  await act.changeCommitmentAmount({ commitment: 'Netflix', amount: eur('17.99') })
  assert.deepEqual((await act.readCommitment('Netflix')).amount, eur('17.99'))
})
