import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const source = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041234567',
  readOn: '2026-06-01',
}

useCase('business.levy.remove-modifier', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.createLevy({
    activity: 'Conseil',
    name: 'Cotisations sociales',
    kind: 'social',
    validFrom: '2026-01-01',
    rate: '20',
    period: 'month',
    source,
  })
  await arrange.addLevyModifier('Conseil', 'Cotisations sociales', {
    label: 'Acre, première année',
    rateFactor: '0.5',
    months: 12,
  })
  await act.removeLevyModifier('Conseil', 'Cotisations sociales', 'Acre, première année')
  assert.deepEqual((await act.readLevies('Conseil'))[0]?.modifiers, [])
})
