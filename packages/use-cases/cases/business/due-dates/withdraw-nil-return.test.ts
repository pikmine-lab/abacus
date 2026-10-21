import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const source = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041234567',
  readOn: '2026-06-01',
}

useCase('business.due-date.withdraw-nil-return', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte pro', opening: eur('1000.00') })
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.createCategory({ name: 'Cotisations' })
  await arrange.createLevy({
    activity: 'Conseil',
    name: 'Cotisations sociales',
    kind: 'social',
    validFrom: '2026-01-01',
    rate: '20',
    period: 'month',
    source,
    settledIn: 'Cotisations',
  })
  await arrange.declareInvoice({
    activity: 'Conseil',
    client: 'Atelier Durand',
    reference: 'F-2026-001',
    issuedOn: '2026-03-02',
    base: eur('1000.00'),
  })
  await arrange.settleInvoice({ reference: 'F-2026-001', account: 'Compte pro', on: '2026-03-10' })
  await arrange.declareNilReturn({
    activity: 'Conseil',
    levy: 'Cotisations sociales',
    periodStart: '2026-01-01',
  })
  await act.withdrawNilReturn({
    activity: 'Conseil',
    levy: 'Cotisations sociales',
    periodStart: '2026-01-01',
  })
  assert.deepEqual(
    await act.readDueDate({ activity: 'Conseil', levy: 'Cotisations sociales', periodStart: '2026-01-01' }),
    { amount: eur('0.00'), status: 'overdue' },
  )
})
