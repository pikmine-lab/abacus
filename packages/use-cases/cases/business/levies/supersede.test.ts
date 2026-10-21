import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const source = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041234567',
  readOn: '2026-06-01',
}

useCase('business.levy.supersede', async ({ arrange, act }) => {
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
  await act.supersedeLevy('Conseil', 'Cotisations sociales', { from: '2026-04-01', rate: '21.2', source })
  assert.deepEqual(await act.readLevies('Conseil'), [
    {
      name: 'Cotisations sociales',
      validFrom: '2026-01-01',
      validTo: '2026-03-31',
      rate: '20',
      modifiers: [],
    },
    { name: 'Cotisations sociales', validFrom: '2026-04-01', validTo: null, rate: '21.2', modifiers: [] },
  ])
})
