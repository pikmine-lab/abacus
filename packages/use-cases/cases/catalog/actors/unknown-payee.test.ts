import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// The one gesture meant to differ from one interface to another: the step
// itself checks that each creates an unknown payee its own way, on the spot or
// only once asked to. All end in the same state.
useCase('catalog.actor.unknown-payee', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.declareExpenseToUnknownPayee({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Fromagerie Lenoir',
    on: '2026-06-10',
  })
  assert.deepEqual(await act.readActors(), [{ name: 'Fromagerie Lenoir', activity: null, aliases: [] }])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('987.50'))
})
