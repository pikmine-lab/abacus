import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.subscription.judge-with-note', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createSubscription({
    label: 'Netflix',
    payee: 'Netflix',
    account: 'Compte courant',
    amount: eur('15.99'),
    firstDueOn: '2026-07-05',
  })
  await act.judgeSubscription({
    subscription: 'Netflix',
    judgment: 'reducible',
    note: 'Passer à l’offre avec pub',
  })
  const { judgment, judgmentNote } = await act.readCommitment('Netflix')
  assert.deepEqual(
    { judgment, judgmentNote },
    { judgment: 'reducible', judgmentNote: 'Passer à l’offre avec pub' },
  )
})
