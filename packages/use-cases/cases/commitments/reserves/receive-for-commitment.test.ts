import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.reserve.receive', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  // Given ahead to pay for the coming months: held for the occurrences, not an income yet.
  await act.receiveForCommitment({
    commitment: 'Netflix',
    account: 'Compte courant',
    payer: 'Famille Durand',
    amount: eur('48.00'),
    on: '2026-06-12',
  })
  assert.deepEqual((await act.readCommitment('Netflix')).reserveLeft, eur('48.00'))
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('1048.00'))
})
