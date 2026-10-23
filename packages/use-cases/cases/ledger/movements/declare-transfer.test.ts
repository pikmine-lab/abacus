import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.movement.declare-transfer', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createAccount({ name: 'Livret A', opening: eur('500.00') })
  await act.declareTransfer({
    from: 'Compte courant',
    to: 'Livret A',
    amount: eur('200.00'),
    on: '2026-06-05',
  })
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('800.00'))
  assert.deepEqual(await act.readAccountBalance('Livret A'), eur('700.00'))
})
