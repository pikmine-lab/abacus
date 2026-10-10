import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { auth } from '@abacus/core/auth'
import { db } from '@abacus/core/db'
import { setupDb, teardownDb, truncateAll } from '../../core/test/helpers.ts'
import { seedDemo } from '../src/seed.ts'
import { closeAuth, DEMO_EMAIL, DEMO_PASSWORD, OWNED_TABLES } from '../src/user.ts'

before(async () => {
  await setupDb()
  await truncateAll()
})
after(async () => {
  await teardownDb()
  await closeAuth()
})

async function rowsOwnedBy(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of OWNED_TABLES) {
    const [row] = await db()<{ count: number }[]>`
      select count(*)::int as count from ${db()(table)} where user_id = ${userId}
    `
    counts[table] = row!.count
  }
  return counts
}

// The seed breaks whenever a domain rule it relies on changes; this is where
// that shows, rather than at the next worktree creation.
test('the demo data writes through every service, and a second run rewrites it whole', async () => {
  const userId = await seedDemo()
  const first = await rowsOwnedBy(userId)
  assert.ok(first.movement! > 0)

  assert.equal(await seedDemo(), userId)
  assert.deepEqual(await rowsOwnedBy(userId), first)
})

test('the demo account signs in with the credentials AGENTS.md gives', async () => {
  const { user } = await auth.api.signInEmail({ body: { email: DEMO_EMAIL, password: DEMO_PASSWORD } })
  assert.equal(user.email, DEMO_EMAIL)
})
