import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.occurrence.confirm-placement', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followUnquotedAsset({ name: 'Fonds Monde', nature: 'fund' })
  await arrange.createInvestmentPlan({
    label: 'Versement Fonds Monde',
    from: 'Compte courant',
    to: 'PEA',
    asset: 'Fonds Monde',
    amount: eur('200.00'),
    firstDueOn: '2026-06-10',
  })
  await act.confirmPlacement({ plan: 'Versement Fonds Monde', quantity: '2.5' })
  assert.equal((await act.readCommitment('Versement Fonds Monde')).nextDueOn, '2026-07-10')
  assert.deepEqual(await act.readAccountBalance('Compte courant'), eur('800.00'))
})
