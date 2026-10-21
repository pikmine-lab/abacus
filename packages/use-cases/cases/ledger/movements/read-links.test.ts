import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

// What a movement is tied to, read on the movement: the commitment an
// occurrence comes from, the invoice and the activity of an income, the
// balance check an adjustment settles.
useCase('ledger.movement.read-links', async ({ arrange, act }) => {
  await arrange.createAccount({ name: 'Compte courant', opening: eur('1000.00') })
  await arrange.createAccount({ name: 'Compte pro', opening: eur('100.00') })
  await arrange.createSubscription({
    label: 'Streaming',
    payee: 'Streamflix',
    account: 'Compte courant',
    amount: eur('15.00'),
    firstDueOn: '2026-06-05',
  })
  await arrange.confirmOccurrence('Streaming')
  await arrange.createActivity({ name: 'Conseil', startedOn: '2026-01-01', accounts: ['Compte pro'] })
  await arrange.declareInvoice({
    activity: 'Conseil',
    client: 'Atelier Durand',
    reference: 'F-2026-001',
    issuedOn: '2026-05-04',
    base: eur('1000.00'),
    vatRate: '0',
  })
  await arrange.settleInvoice({ reference: 'F-2026-001', account: 'Compte pro', on: '2026-06-10' })
  await arrange.createActor('Écart inexpliqué')
  await arrange.recordBalanceCheck({ account: 'Compte courant', balance: eur('980.00') })
  await arrange.settleCheckGap({ account: 'Compte courant', on: '2026-06-15', actor: 'Écart inexpliqué' })
  assert.deepEqual(await act.readMovementLinks({ counterparty: 'Streamflix', on: '2026-06-05' }), {
    commitment: 'Streaming',
    origin: 'commitment',
  })
  assert.deepEqual(await act.readMovementLinks({ counterparty: 'Atelier Durand', on: '2026-06-10' }), {
    activity: 'Conseil',
    invoice: 'F-2026-001',
  })
  assert.deepEqual(await act.readMovementLinks({ counterparty: 'Écart inexpliqué', on: '2026-06-15' }), {
    origin: 'balanceCheck',
  })
})
