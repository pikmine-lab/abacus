import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import {
  addAlias,
  countReattachableMovements,
  createActor,
  editActor,
  listActorsWithAliases,
  mergeActors,
  reattachActorHistory,
  resolveActor,
} from '../src/services/actors.ts'
import { createActivity } from '../src/services/catalog.ts'
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
  const freelance = await createActivity(user, { name: 'Freelance' })
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

test('an actor is read with the names that also resolve to it', async () => {
  const user = await seedUser()
  const freelance = await createActivity(user, { name: 'Freelance' })
  await createActor(user, { name: "McDonald's", aliases: ['Macdo', 'McDo'] })
  await createActor(user, { name: 'ACME', activityId: freelance.id })

  const listed = await listActorsWithAliases(user)
  assert.deepEqual(
    listed.map((a) => [a.name, a.aliases]),
    [
      ['ACME', []],
      ["McDonald's", ['Macdo', 'McDo']],
    ],
  )
  assert.equal(listed[0]!.activityId, freelance.id)
})

test('attaching an activity counts the history left behind, and reattaching takes what was inheriting', async () => {
  const user = await seedUser()
  const freelance = await createActivity(user, { name: 'Freelance' })
  const other = await createActivity(user, { name: 'Formation' })
  const account = await createAccount({ userId: user, name: 'Main', behavior: 'payment' })
  const acme = await createActor(user, { name: 'ACME' })
  const declare = (happenedOn: string, activityId?: string) =>
    declareMovement(user, {
      happenedOn,
      amount: 100,
      sourceActorId: acme.id,
      targetAccountId: account.id,
      activityId,
    })
  const early = await declare('2026-01-10')
  const late = await declare('2026-03-05')
  // Set on purpose: an explicit classification, never taken along.
  const explicit = await declare('2026-02-01', other.id)

  const edited = await editActor(user, acme.id, { activityId: freelance.id })
  assert.equal(edited.leftBehind, 2)
  assert.deepEqual(await countReattachableMovements(user, acme.id), { count: 2, since: '2026-01-10' })
  assert.deepEqual(await countReattachableMovements(user, acme.id, { from: '2026-02-01' }), {
    count: 1,
    since: '2026-03-05',
  })

  assert.equal(await reattachActorHistory(user, acme.id, { from: '2026-02-01' }), 1)
  const byId = new Map((await listMovements(user)).map((m) => [m.id, m.activityId]))
  assert.equal(byId.get(late.id), freelance.id)
  assert.equal(byId.get(early.id), null)
  assert.equal(byId.get(explicit.id), other.id)

  // Editing without changing the activity leaves nothing new behind.
  assert.equal((await editActor(user, acme.id, { note: 'client' })).leftBehind, 0)
  assert.equal(await reattachActorHistory(user, acme.id), 1)
  assert.equal((await countReattachableMovements(user, acme.id)).count, 0)
})

test('the former activity comes along when it is named, and only then', async () => {
  const user = await seedUser()
  const before = await createActivity(user, { name: 'Freelance' })
  const after = await createActivity(user, { name: 'Formation' })
  const explicit = await createActivity(user, { name: 'Conseil' })
  const account = await createAccount({ userId: user, name: 'Main', behavior: 'payment' })
  const acme = await createActor(user, { name: 'ACME', activityId: before.id })
  const inherited = await declareMovement(user, {
    happenedOn: '2026-01-10',
    amount: 100,
    sourceActorId: acme.id,
    targetAccountId: account.id,
  })
  const overridden = await declareMovement(user, {
    happenedOn: '2026-01-11',
    amount: 100,
    sourceActorId: acme.id,
    targetAccountId: account.id,
    activityId: explicit.id,
  })

  assert.equal((await editActor(user, acme.id, { activityId: after.id })).leftBehind, 1)
  // Without the former activity, a movement carrying one is an explicit choice.
  assert.equal(await reattachActorHistory(user, acme.id), 0)
  // Naming the current activity as the former one names nothing.
  assert.equal(await reattachActorHistory(user, acme.id, { previousActivityId: after.id }), 0)

  assert.equal(await reattachActorHistory(user, acme.id, { previousActivityId: before.id }), 1)
  const byId = new Map((await listMovements(user)).map((m) => [m.id, m.activityId]))
  assert.equal(byId.get(inherited.id), after.id)
  assert.equal(byId.get(overridden.id), explicit.id)

  // Detaching the actor leaves nothing to propose: there is no activity to reattach to.
  assert.equal((await editActor(user, acme.id, { activityId: null })).leftBehind, 0)
  await assert.rejects(
    reattachActorHistory(user, acme.id),
    (e: DomainError) => e.code === 'actor_has_no_activity',
  )
})

test("reattaching stays within the user's own history", async () => {
  const user = await seedUser('user-1')
  const other = await seedUser('user-2')
  const mine = await createActivity(user, { name: 'Freelance' })
  const theirs = await createActivity(other, { name: 'Freelance' })
  const myAccount = await createAccount({ userId: user, name: 'Main', behavior: 'payment' })
  const theirAccount = await createAccount({ userId: other, name: 'Main', behavior: 'payment' })
  const myActor = await createActor(user, { name: 'ACME' })
  const theirActor = await createActor(other, { name: 'ACME' })
  await declareMovement(user, {
    happenedOn: '2026-01-10',
    amount: 100,
    sourceActorId: myActor.id,
    targetAccountId: myAccount.id,
  })
  await declareMovement(other, {
    happenedOn: '2026-01-10',
    amount: 100,
    sourceActorId: theirActor.id,
    targetAccountId: theirAccount.id,
  })
  await editActor(user, myActor.id, { activityId: mine.id })
  await editActor(other, theirActor.id, { activityId: theirs.id })

  await assert.rejects(
    reattachActorHistory(user, theirActor.id),
    (e: DomainError) => e.code === 'actor_not_found',
  )
  await assert.rejects(
    countReattachableMovements(user, theirActor.id),
    (e: DomainError) => e.code === 'actor_not_found',
  )
  assert.equal(await reattachActorHistory(user, myActor.id), 1)
  assert.equal((await listMovements(other))[0]!.activityId, null)
})
