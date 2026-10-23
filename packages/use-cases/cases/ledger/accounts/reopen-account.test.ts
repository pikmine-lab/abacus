import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.account.reopen', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('300.00') })
  await arrange.closeAccount('Compte courant')
  await act.reopenAccount('Compte courant')
  assert.deepEqual(await act.readAccount('Compte courant'), { balance: eur('300.00'), closed: false })
})
