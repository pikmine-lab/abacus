import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// The alias resolves to the actor: an expense declared under it creates no
// duplicate and counts under the actor.
useCase('catalog.actor.add-alias', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createActor("McDonald's")
  await act.addAlias({ actor: "McDonald's", alias: 'Macdo' })
  await act.declareExpense({
    account: 'Compte courant',
    amount: eur('12.00'),
    payee: 'Macdo',
    on: '2026-06-10',
  })
  assert.deepEqual(await act.readActors(), [{ name: "McDonald's", activity: null }])
  assert.deepEqual(await act.readFlows({ kind: 'expense', by: 'actor', month: '2026-06' }), [
    { label: "McDonald's", amount: eur('12.00') },
  ])
})
