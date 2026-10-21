import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('commitments.investment-plan.change-amount', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createInvestmentAccount({ name: 'PEA' })
  await arrange.followUnquotedAsset({ name: 'Fonds Monde', nature: 'fund' })
  await arrange.createInvestmentPlan({
    label: 'Versement Fonds Monde',
    from: 'Compte courant',
    to: 'PEA',
    asset: 'Fonds Monde',
    amount: eur('200.00'),
    firstDueOn: '2026-07-10',
  })
  await act.changeCommitmentAmount({ commitment: 'Versement Fonds Monde', amount: eur('250.00') })
  assert.deepEqual((await act.readCommitment('Versement Fonds Monde')).amount, eur('250.00'))
})
