import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.occurrence.skip', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-06-05',
  })
  // A free month: nothing left the account.
  await act.skipOccurrence('Netflix')
  assert.equal((await act.readCommitment('Netflix')).nextDueOn, '2026-07-05')
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('1000.00'))
})
