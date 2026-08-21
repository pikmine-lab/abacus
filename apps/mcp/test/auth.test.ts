import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { auth } from '@abacus/core/auth'
import { seedUser, setupDb, teardownDb, truncateAll } from '../../../packages/core/test/helpers.ts'
import { verifyApiKeyToken } from '../src/auth.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

async function keyFor(userId: string): Promise<string> {
  const created = await auth.api.createApiKey({ body: { name: 'test', userId } })
  return created.key
}

// The api-key plugin rate-limits by default: ten requests, then refusal until a
// whole day passes without a single one. An MCP client verifies its key on every
// request, so that ceiling used to kill a key inside one working session.
test('a key survives far more requests than a session makes', async () => {
  const user = await seedUser()
  const key = await keyFor(user)

  for (let i = 0; i < 40; i++) {
    const info = await verifyApiKeyToken(key)
    assert.equal((info.extra as { userId: string }).userId, user, `verification ${i + 1} lost the user`)
  }
})

test('an unknown key is refused', async () => {
  await assert.rejects(() => verifyApiKeyToken('not-a-key'))
})
