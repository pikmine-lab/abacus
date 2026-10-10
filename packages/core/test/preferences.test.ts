import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  languagePreference,
  rankingViewPreference,
  readingPreference,
  setLanguagePreference,
  setRankingViewPreference,
  setReadingPreference,
} from '../src/services/preferences.ts'
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

test('the ranking opens as a strip until someone settles otherwise', async () => {
  const user = await seedUser()

  assert.equal(await rankingViewPreference(user), 'strip')
  await setRankingViewPreference(user, 'bars')
  assert.equal(await rankingViewPreference(user), 'bars')
})

test('settling one preference leaves the other as it was', async () => {
  const user = await seedUser()

  await setReadingPreference(user, 'accrual')
  await setRankingViewPreference(user, 'bars')
  assert.equal(await readingPreference(user), 'accrual')

  await setReadingPreference(user, 'cash')
  assert.equal(await rankingViewPreference(user), 'bars')
})

test('the language follows the browser until someone chooses, and can be handed back', async () => {
  const user = await seedUser()

  assert.equal(await languagePreference(user), null)
  await setLanguagePreference(user, 'en')
  assert.equal(await languagePreference(user), 'en')
  await setLanguagePreference(user, null)
  assert.equal(await languagePreference(user), null)
})
