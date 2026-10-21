import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('ledger.account.edit', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.editAccount({
    account: 'Compte courant',
    name: 'Compte joint',
    institution: 'Banque Martin',
    opening: eur('1500.00'),
  })
  assert.deepEqual(await act.readAccount('Compte joint'), {
    institution: 'Banque Martin',
    balance: eur('1500.00'),
    closed: false,
  })
})
