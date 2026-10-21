import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('identity.isolation.someone-else', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Mon compte', opening: eur('100.00') })
  const theirs = await arrange.someoneElseDeclares({
    account: 'Compte de Dominique',
    amount: eur('40.00'),
    payee: 'Librairie',
    on: '2026-06-01',
  })
  assert.deepEqual(await act.readAccountNames(), ['Mon compte'])
  assert.equal(await act.correctSomeoneElsesMovement(theirs.movementId, eur('1.00')), 'refused')
})
