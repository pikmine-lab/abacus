import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.balance-check.record-with-note', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.recordBalanceCheck({
    account: 'Compte courant',
    balance: eur('1000.00'),
    note: 'Lu sur le relevé papier',
  })
  assert.deepEqual(await act.readBalanceChecks('Compte courant'), [
    {
      on: '2026-06-15',
      declared: eur('1000.00'),
      computed: eur('1000.00'),
      gap: eur('0.00'),
      settled: false,
      note: 'Lu sur le relevé papier',
    },
  ])
})
