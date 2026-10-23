import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.financing.end', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createFinancing({
    label: 'Canapé',
    creditor: 'Meubles Martin',
    account: 'Compte courant',
    total: eur('900.00'),
    instalments: 3,
    firstDueOn: '2026-07-01',
  })
  await act.endCommitment('Canapé')
  assert.deepEqual(await act.readRunningCommitments(), [])
})
