import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('business.activity.edit', async ({ arrange, act }) => {
  await arrange.createActivity({ name: 'Freelance', startedOn: '2026-01-01', regimeLabel: 'Micro' })
  await act.editActivity('Freelance', { name: 'Conseil', regimeLabel: 'Micro-entreprise' })
  const activity = await act.readActivity('Conseil')
  assert.deepEqual(
    { name: activity.name, regimeLabel: activity.regimeLabel },
    { name: 'Conseil', regimeLabel: 'Micro-entreprise' },
  )
})
