import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const source = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041234567',
  readOn: '2026-06-01',
}

useCase('business.invoice.settle', async ({ arrange, act }) => {
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
  await arrange.declareInvoice({
    activity: 'Conseil',
    client: 'Atelier Durand',
    reference: 'F-2026-001',
    issuedOn: '2026-05-04',
    dueOn: '2026-07-04',
    base: eur('1000.00'),
    vatRate: '20',
  })
  await act.settleInvoice({ reference: 'F-2026-001', account: 'Compte pro', on: '2026-06-15' })
  assert.equal((await act.readInvoice('F-2026-001')).state, 'paid')
  assert.deepEqual(await act.readAccountBalance('Compte pro'), eur('2200.00'))
})
