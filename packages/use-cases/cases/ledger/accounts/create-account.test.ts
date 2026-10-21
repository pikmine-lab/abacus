import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.account.create', async ({ act }) => {
  await act.createAccount({ name: 'Compte courant', opening: eur('1250.00'), openedOn: '2026-03-01' })
  assert.deepEqual(await act.readAccount('Compte courant'), { balance: eur('1250.00'), closed: false })
})
