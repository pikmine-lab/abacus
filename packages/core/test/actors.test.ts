import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { DomainError } from '../src/domain/errors.ts'
import { createActivity } from '../src/services/catalog.ts'
import { addAlias, createActor, mergeActors, resolveActor } from '../src/services/actors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { declareMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('resolves an actor by canonical name, alias, and case-insensitively', async () => {
  const user = await seedUser()
  const actor = await createActor(user, { name: "McDonald's", aliases: ['McDo', 'Macdo'] })

  assert.equal((await resolveActor(user, "mcdonald's")).match?.id, actor.id)
  assert.equal((await resolveActor(user, 'MACDO')).match?.id, actor.id)
})

test('suggests close names instead of matching', async () => {
  const user = await seedUser()
  const actor = await createActor(user, { name: "McDonald's" })

  const resolution = await resolveActor(user, 'McDonald')
  assert.equal(resolution.match, null)
  assert.equal(resolution.suggestions[0]?.id, actor.id)
})

test('rejects a duplicate name or alias', async () => {
  const user = await seedUser()
  await createActor(user, { name: 'Glovo', aliases: ['glv'] })

  await assert.rejects(createActor(user, { name: 'glovo' }), (e: DomainError) => e.code === 'actor_exists')
  const other = await createActor(user, { name: 'Uber Eats' })
  await assert.rejects(addAlias(user, other.id, 'GLV'), (e: DomainError) => e.code === 'alias_taken')
})

test('merging reassigns references and keeps the absorbed name as alias', async () => {
  const user = await seedUser()
  const freelance = await createActivity(user, 'Freelance')
  const keep = await createActor(user, { name: 'ACME', activityId: freelance.id })
  const dup = await createActor(user, { name: 'ACME Corp' })
  const account = await createAccount({ userId: user, name: 'Main', behavior: 'payment' })
  await declareMovement(user, {
    happenedOn: '2026-01-10',
    amount: 500,
    sourceActorId: dup.id,
    targetAccountId: account.id,
  })

  await mergeActors(user, keep.id, dup.id)

  const [movement] = await listMovements(user)
  assert.equal(movement!.sourceActorId, keep.id)
  assert.equal((await resolveActor(user, 'ACME Corp')).match?.id, keep.id)
})
