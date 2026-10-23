import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Who a subscription pays, how it is filed, and what comes back of it a month.
useCase('commitments.subscription.read-terms', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createCategory({ name: 'Loisirs' })
  await arrange.createActivity({ name: 'Atelier', kind: 'personal' })
  await arrange.createSubscription({
    label: 'Streaming',
    payee: 'Streamflix',
    account: 'Compte courant',
    amount: eur('15.00'),
    firstDueOn: '2026-07-05',
  })
  await arrange.correctCommitment({
    commitment: 'Streaming',
    category: 'Loisirs',
    activity: 'Atelier',
    shares: [{ debtor: 'Paul', amount: eur('5.00') }],
  })
  assert.deepEqual(await act.readCommitmentTerms('Streaming'), {
    payee: 'Streamflix',
    category: 'Loisirs',
    activity: 'Atelier',
    monthlyExpectedRefund: eur('5.00'),
  })
})
