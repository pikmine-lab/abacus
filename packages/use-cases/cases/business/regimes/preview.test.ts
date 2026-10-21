import assert from 'node:assert/strict'
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

useCase('business.regime.preview', async ({ act }) => {
  assert.deepEqual(await act.previewRegime(france), {
    model: 'Micro-entreprise, versement libératoire',
    rules: [
      'Cotisations sociales',
      "Versement libératoire de l'impôt sur le revenu",
      'Contribution à la formation professionnelle',
      'Cotisation foncière des entreprises',
    ],
  })
})
