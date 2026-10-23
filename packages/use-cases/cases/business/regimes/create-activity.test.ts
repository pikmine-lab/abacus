import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const france = {
  jurisdiction: 'France',
  answers: [
    'Profession libérale non réglementée (BNC)',
    'Par le versement libératoire, avec les cotisations',
    'Tous les trimestres',
    'Non, je suis en franchise en base',
    'Non',
  ],
}

useCase('business.regime.create-activity', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await act.createActivityFromRegime({
    ...france,
    name: 'Conseil',
    startedOn: '2026-02-01',
    accounts: ['Compte pro'],
  })
  const rules = await act.readLevies('Conseil')
  assert.deepEqual(
    rules.map((r) => r.name).sort(),
    [
      'Cotisations sociales',
      "Versement libératoire de l'impôt sur le revenu",
      'Contribution à la formation professionnelle',
      'Cotisation foncière des entreprises',
    ].sort(),
  )
  assert.deepEqual((await act.readActivity('Conseil')).accounts, ['Compte pro'])
})
