import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('catalog.category.edit', async ({ arrange, act }) => {
  await arrange.createCategory({ name: 'Courses', group: 'Vie courante' })
  await arrange.createCategory({ name: 'Restos' })
  await act.editCategory({ category: 'Restos', name: 'Restaurants', group: 'Vie courante' })
  await act.editCategory({ category: 'Courses', group: null })
  assert.deepEqual(await act.readCategories(), [
    { name: 'Restaurants', group: 'Vie courante' },
    { name: 'Courses', group: null },
  ])
})
