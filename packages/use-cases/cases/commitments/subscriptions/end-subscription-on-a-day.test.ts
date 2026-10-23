import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// A subscription cancelled with notice ends on the day the notice runs out.
useCase('commitments.subscription.end-on-a-day', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  await act.endCommitment('Netflix', '2026-07-31')
  assert.equal(await act.readCommitmentEnd('Netflix'), '2026-07-31')
})
