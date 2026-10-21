import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.commitment.rename', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  await act.renameCommitment({ commitment: 'Netflix', label: 'Netflix Premium' })
  assert.deepEqual(await act.readCommitment('Netflix Premium'), {
    account: 'Compte courant',
    amount: eur('15.99'),
    nextDueOn: '2026-07-05',
  })
})
