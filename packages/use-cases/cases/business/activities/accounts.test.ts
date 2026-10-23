import assert from 'node:assert/strict'
import { eur } from '@abacus/use-case-language'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.accounts', async ({ arrange, act }) => {
  // Linked at creation, then corrected: both paths lead to the same list.
  await arrange.createAccount({ name: 'Compte courant' })
  await arrange.createAccount({ name: 'Compte pro' })
  await arrange.createAccount({ name: 'Livret pro', opening: eur('500.00') })
  await act.createActivity({
    name: 'Conseil',
    startedOn: '2026-01-01',
    accounts: ['Compte courant', 'Compte pro'],
  })
  assert.deepEqual((await act.readActivity('Conseil')).accounts, ['Compte courant', 'Compte pro'])
  await act.setActivityAccounts('Conseil', ['Compte pro', 'Livret pro'])
  assert.deepEqual((await act.readActivity('Conseil')).accounts, ['Compte pro', 'Livret pro'])
})
