import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// What the person owns: the balance of every account, an investment
// account's cash included, plus its holdings at their last known price.
useCase('reporting.overview.wealth', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createInvestmentAccount({ name: 'PEA', opening: eur('6000.00'), openedOn: '2026-05-01' })
  await arrange.followInstrument({ query: 'amundi world', ticker: 'WRLD.PA', as: 'Amundi World' })
  await arrange.recordOperation({
    account: 'PEA',
    type: 'buy',
    asset: 'Amundi World',
    quantity: '10',
    amount: eur('5000.00'),
    on: '2026-06-01',
  })
  await arrange.declareExpense({
    account: 'Compte courant',
    amount: eur('40.00'),
    payee: 'Le Bistrot',
    on: '2026-06-03',
  })
  assert.deepEqual(await act.readWealth(), eur('7160.00'))
})
