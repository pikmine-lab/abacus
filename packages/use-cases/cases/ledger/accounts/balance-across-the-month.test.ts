import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// Round amounts: some interfaces draw the balances to the euro.
useCase('ledger.account.balance-across-the-month', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00'), openedOn: '2026-06-01' })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('13.00'),
    payee: 'Boulangerie',
    on: '2026-06-10',
  })
  assert.deepEqual(await act.readBalanceAcrossTheMonth('Compte courant'), {
    first: { on: '2026-06-01', balance: eur('1000.00') },
    last: { on: '2026-06-30', balance: eur('987.00') },
  })
})
