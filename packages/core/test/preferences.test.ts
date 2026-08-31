import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { readingPreference, setReadingPreference } from '../src/services/preferences.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('someone who never settled a reading is served the default', async () => {
  const user = await seedUser()

  assert.equal(await readingPreference(user), 'cash')
})

test('the settled reading survives, and settling again replaces it', async () => {
  const user = await seedUser()

  await setReadingPreference(user, 'accrual')
  assert.equal(await readingPreference(user), 'accrual')

  await setReadingPreference(user, 'cash')
  assert.equal(await readingPreference(user), 'cash')
})

test('a reading belongs to the person who settled it', async () => {
  const accrual = await seedUser('user-accrual')
  const untouched = await seedUser('user-untouched')

  await setReadingPreference(accrual, 'accrual')

  assert.equal(await readingPreference(accrual), 'accrual')
  assert.equal(await readingPreference(untouched), 'cash')
})
