import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.financing.create', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.createFinancing({
    label: 'Canapé',
    creditor: 'Meubles Martin',
    account: 'Compte courant',
    total: eur('900.00'),
    instalments: 3,
    firstDueOn: '2026-07-01',
  })
  assert.deepEqual(await act.readCommitment('Canapé'), {
    account: 'Compte courant',
    amount: eur('300.00'),
    nextDueOn: '2026-07-01',
    remainingDue: eur('900.00'),
  })
  assert.deepEqual(await act.readSchedule('Canapé'), [
    { dueOn: '2026-07-01', amount: eur('300.00') },
    { dueOn: '2026-08-01', amount: eur('300.00') },
    { dueOn: '2026-09-01', amount: eur('300.00') },
  ])
})
