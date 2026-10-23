import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.subscription.create', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  assert.deepEqual(await act.readCommitment('Netflix'), {
    account: 'Compte courant',
    amount: eur('15.99'),
    nextDueOn: '2026-07-05',
  })
})
