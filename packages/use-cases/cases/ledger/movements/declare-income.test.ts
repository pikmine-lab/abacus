import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.movement.declare-income', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.declareIncome({
    account: 'Compte courant',
    amount: eur('250.00'),
    payer: 'Acme',
    on: '2026-06-05',
  })
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('1250.00'))
})
