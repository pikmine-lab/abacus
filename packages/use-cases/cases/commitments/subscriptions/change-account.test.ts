import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.commitment.change-account', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  await arrange.createAccount({ name: 'Compte joint', opening: eur('500.00') })
  await act.changeCommitmentAccount({ commitment: 'Netflix', account: 'Compte joint' })
  assert.equal((await act.readCommitment('Netflix')).account, 'Compte joint')
})
