import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('catalog.category.create', async ({ act }) => {
  await act.createCategory({ name: 'Restaurants', group: 'Vie courante' })
  await act.createCategory({ name: 'Loyer' })
  assert.deepEqual(await act.readCategories(), [
    { name: 'Restaurants', group: 'Vie courante' },
    { name: 'Loyer', group: null },
  ])
})
