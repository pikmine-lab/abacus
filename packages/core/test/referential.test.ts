import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import {
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  reopenAccount,
} from '../src/services/accounts.ts'
import { createActor, editActor, listActors, resolveActor } from '../src/services/actors.ts'
import {
  createActivity,
  createCategory,
  editActivity,
  editCategory,
  listActivities,
  listCategories,
} from '../src/services/catalog.ts'
import { declareMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('an account corrects its name, its institution and its behavior', async () => {
  const user = await seedUser()
  const account = await createAccount({
    userId: user,
    name: 'Curent',
    behavior: 'payment',
    institution: 'Bank',
  })

  const fixed = await editAccount(user, account.id, {
    name: 'Courant',
    institution: null,
    behavior: 'savings',
  })
  assert.equal(fixed.name, 'Courant')
  assert.equal(fixed.institution, null)
  assert.equal(fixed.behavior, 'savings')

  // An empty correction is not an error: it changes nothing.
  assert.equal((await editAccount(user, account.id, {})).name, 'Courant')
})

test('a name already taken is refused, whether created or corrected', async () => {
  const user = await seedUser()
  await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })
  const savings = await createAccount({ userId: user, name: 'Livret', behavior: 'savings' })

  await assert.rejects(
    createAccount({ userId: user, name: 'courant', behavior: 'payment' }),
    (e: DomainError) => e.code === 'account_exists',
  )
  await assert.rejects(
    editAccount(user, savings.id, { name: 'COURANT' }),
    (e: DomainError) => e.code === 'account_exists',
  )
})

test('the behavior of an account holding investment operations no longer moves', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'PEA', behavior: 'investment' })
  await db()`
    insert into investment_operation (user_id, account_id, type, amount, operated_on)
    values (${user}, ${account.id}, 'fee', 12, '2026-02-01')
  `

  await assert.rejects(
    editAccount(user, account.id, { behavior: 'payment' }),
    (e: DomainError) => e.code === 'account_has_operations',
  )
  // Everything else about it still corrects, and so does the same behavior.
  assert.equal((await editAccount(user, account.id, { name: 'PEA Bourse' })).name, 'PEA Bourse')
  assert.equal((await editAccount(user, account.id, { behavior: 'investment' })).behavior, 'investment')
})

test('closing the wrong account is not a dead end', async () => {
  const user = await seedUser()
  const account = await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })

  await closeAccount(user, account.id, '2026-01-31')
  assert.equal((await listAccounts(user))[0]!.closedOn, '2026-01-31')
  assert.equal((await reopenAccount(user, account.id)).closedOn, null)
})

test('an actor corrects its name and its activity, and the history stays put', async () => {
  const user = await seedUser()
  const freelance = await createActivity(user, 'Freelance')
  const account = await createAccount({ userId: user, name: 'Courant', behavior: 'payment' })
  const actor = await createActor(user, { name: 'ACME Crop' })
  await declareMovement(user, {
    happenedOn: '2026-02-10',
    amount: 900,
    sourceActorId: actor.id,
    targetAccountId: account.id,
  })

  const fixed = await editActor(user, actor.id, { name: 'ACME Corp', activityId: freelance.id })
  assert.equal(fixed.name, 'ACME Corp')
  assert.equal(fixed.activityId, freelance.id)

  // The typo stops resolving; attaching the activity does not reclassify what
  // was already written under it.
  assert.equal((await resolveActor(user, 'ACME Corp')).match?.id, actor.id)
  assert.equal((await resolveActor(user, 'ACME Crop')).match, null)
  assert.equal((await listMovements(user))[0]!.activityId, null)
})

test('a category and an activity rename, and a taken name is refused', async () => {
  const user = await seedUser()
  const groceries = await createCategory(user, 'Corses', 'Everyday')
  await createCategory(user, 'Rent')
  const freelance = await createActivity(user, 'Frelance')
  await createActivity(user, 'Rental')

  const fixed = await editCategory(user, groceries.id, { name: 'Courses', groupLabel: null })
  assert.equal(fixed.name, 'Courses')
  assert.equal(fixed.groupLabel, null)
  assert.equal((await editActivity(user, freelance.id, 'Freelance')).name, 'Freelance')

  await assert.rejects(
    editCategory(user, groceries.id, { name: 'rent' }),
    (e: DomainError) => e.code === 'category_exists',
  )
  await assert.rejects(
    editActivity(user, freelance.id, 'RENTAL'),
    (e: DomainError) => e.code === 'activity_exists',
  )
  assert.deepEqual(
    (await listCategories(user)).map((c) => c.name),
    ['Courses', 'Rent'],
  )
  assert.deepEqual(
    (await listActivities(user)).map((a) => a.name),
    ['Freelance', 'Rental'],
  )
  assert.equal((await listActors(user)).length, 0)
})

test('correcting something that is not yours fails as missing', async () => {
  const user = await seedUser()
  const other = await seedUser('user-2')
  const account = await createAccount({ userId: other, name: 'Theirs', behavior: 'payment' })
  const actor = await createActor(other, { name: 'Theirs' })
  const category = await createCategory(other, 'Theirs')
  const activity = await createActivity(other, 'Theirs')

  await assert.rejects(
    editAccount(user, account.id, { name: 'Mine' }),
    (e: DomainError) => e.code === 'account_not_found',
  )
  await assert.rejects(
    editActor(user, actor.id, { name: 'Mine' }),
    (e: DomainError) => e.code === 'actor_not_found',
  )
  await assert.rejects(
    editCategory(user, category.id, { name: 'Mine' }),
    (e: DomainError) => e.code === 'category_not_found',
  )
  await assert.rejects(
    editActivity(user, activity.id, 'Mine'),
    (e: DomainError) => e.code === 'activity_not_found',
  )
})
