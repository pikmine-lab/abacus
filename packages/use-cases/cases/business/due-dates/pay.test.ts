import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

const source = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041234567',
  readOn: '2026-06-01',
}

useCase('business.due-date.pay', async ({ arrange, act }) => {
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
  await act.payLevy({
    ...{ activity: 'Conseil', levy: 'Cotisations sociales', periodStart: '2026-03-01' },
    amount: eur('200.00'),
    on: '2026-04-20',
    account: 'Compte pro',
    payee: 'Urssaf',
  })
  assert.deepEqual(
    await act.readDueDate({ activity: 'Conseil', levy: 'Cotisations sociales', periodStart: '2026-03-01' }),
    { amount: eur('200.00'), status: 'paid' },
  )
  // The payment leaves the reserve and comes off the net.
  assert.deepEqual(await act.readStatement('Conseil', 2026), {
    revenue: eur('1000.00'),
    net: eur('800.00'),
    reserve: eur('0.00'),
  })
})
