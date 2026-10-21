import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// The one case where the interfaces are meant to differ (C65): the step
// itself checks that each one creates an unknown payee its own way, the web
// on the spot and the MCP only once asked to. Both end in the same state.
useCase('catalog.actor.unknown-payee', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await act.declareExpenseToUnknownPayee({
    account: 'Compte courant',
    amount: eur('12.50'),
    payee: 'Fromagerie Lenoir',
    on: '2026-06-10',
  })
  assert.deepEqual(await act.readActors(), [{ name: 'Fromagerie Lenoir', activity: null }])
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('987.50'))
})
