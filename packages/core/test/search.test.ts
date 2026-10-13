import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { MAX_SEARCH_TERMS, matchesSearch, searchTerms } from '../src/domain/search.ts'
import { createAccount } from '../src/services/accounts.ts'
import { addAlias, createActor } from '../src/services/actors.ts'
import { linkCandidates } from '../src/services/advances.ts'
import { createCategory } from '../src/services/catalog.ts'
import { declareMovement, listMovements } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

test('a search is read word by word, an amount as a prefix of euros', () => {
  assert.deepEqual(searchTerms('  resto   86 '), [
    { text: 'resto' },
    { text: '86', amount: { from: '86.00', to: '87.00' } },
  ])
  assert.deepEqual(searchTerms('86,4'), [{ text: '86,4', amount: { from: '86.40', to: '86.50' } }])
  assert.deepEqual(searchTerms('86.45€'), [{ text: '86.45', amount: { from: '86.45', to: '86.46' } }])
  // Groups of three digits are one amount, still matched as typed in a text.
  assert.deepEqual(searchTerms('1 200,5 €'), [
    { text: '1 200,5', amount: { from: '1200.50', to: '1200.60' } },
  ])
  // A group that does not end the number is another word.
  assert.deepEqual(searchTerms('86 100%'), [
    { text: '86', amount: { from: '86.00', to: '87.00' } },
    { text: '100%' },
  ])
  assert.deepEqual(searchTerms('4G'), [{ text: '4G' }])
  assert.deepEqual(searchTerms(''), [])
  assert.deepEqual(searchTerms(' € '), [])
  // A pasted paragraph is not a query per word.
  assert.equal(searchTerms('a b c d e f g h i j k l').length, MAX_SEARCH_TERMS)
})

test('what is matched outside the query follows the same rule', () => {
  const claim = { texts: ['Léa', 'Le Bistrot du 10/05'], amounts: [86.4, 172.8] }
  const matches = (input: string) => matchesSearch(searchTerms(input), claim.texts, claim.amounts)
  assert.equal(matches('lea bistrot'), true)
  assert.equal(matches('86.4'), true)
  assert.equal(matches('86,4'), true)
  assert.equal(matches('172'), true)
  assert.equal(matches('86,5'), false)
  assert.equal(matches('lea cafe'), false)
  assert.equal(matches(''), true)
})

async function ledger(user: string) {
  const checking = await createAccount({ userId: user, name: 'Compte joint', behavior: 'payment' })
  const food = await createCategory(user, 'Restaurants', 'Sorties')
  const resto = await createActor(user, { name: 'Le Petit Café' })
  await addAlias(user, resto.id, 'Chez Momo')
  const shop = await createActor(user, { name: 'Bricoshop' })
  const resto86 = await declareMovement(user, {
    happenedOn: '2025-01-10',
    amount: 86.4,
    sourceAccountId: checking.id,
    targetActorId: resto.id,
    categoryId: food.id,
    note: 'Anniversaire de Léa',
  })
  const resto12 = await declareMovement(user, {
    happenedOn: '2026-03-02',
    amount: 12,
    sourceAccountId: checking.id,
    targetActorId: resto.id,
    categoryId: food.id,
  })
  const shop186 = await declareMovement(user, {
    happenedOn: '2026-03-05',
    amount: 186,
    sourceAccountId: checking.id,
    targetActorId: shop.id,
    note: 'Perceuse 100% neuve',
  })
  return { resto86: resto86.id, resto12: resto12.id, shop186: shop186.id }
}

const found = async (user: string, search: string) =>
  (await listMovements(user, { search })).map((m) => m.id).sort()

test('every word must be found, each in any field, case and accents ignored', async () => {
  const user = await seedUser()
  const { resto86, resto12, shop186 } = await ledger(user)

  // A fragment of the counterparty, without its accent.
  assert.deepEqual(await found(user, 'cafe'), [resto12, resto86].sort())
  // Two words, two fields: the counterparty and the amount.
  assert.deepEqual(await found(user, 'petit 86'), [resto86])
  // The amount alone reads as a prefix of euros: 86 is not 186.
  assert.deepEqual(await found(user, '86'), [resto86])
  assert.deepEqual(await found(user, '86,4'), [resto86])
  assert.deepEqual(await found(user, '86,5'), [])
  // The note, typed with or without its accent.
  assert.deepEqual(await found(user, 'lea'), [resto86])
  assert.deepEqual(await found(user, 'LÉA'), [resto86])
  // An alias of the counterparty, the category, its group, the account.
  assert.deepEqual(await found(user, 'momo 12'), [resto12])
  assert.deepEqual(await found(user, 'restaurants'), [resto12, resto86].sort())
  assert.deepEqual(await found(user, 'sorties'), [resto12, resto86].sort())
  assert.deepEqual(await found(user, 'joint brico'), [shop186])
  // A wildcard typed is a character, not a pattern.
  assert.deepEqual(await found(user, '100%'), [shop186])
  assert.deepEqual(await found(user, '_'), [])
  // A word found nowhere empties the result, whatever the others match.
  assert.deepEqual(await found(user, 'cafe introuvable'), [])
})

test('a link is offered across the whole history, never to an income that already says what it is', async () => {
  const user = await seedUser()
  const checking = await createAccount({ userId: user, name: 'Checking', behavior: 'payment' })
  const lea = await createActor(user, { name: 'Léa' })
  const old = await declareMovement(user, {
    happenedOn: '2023-06-01',
    amount: 60,
    sourceAccountId: checking.id,
    targetActorId: lea.id,
  })
  const free = await declareMovement(user, {
    happenedOn: '2026-01-02',
    amount: 20,
    sourceActorId: lea.id,
    targetAccountId: checking.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-01-03',
    amount: 30,
    sourceActorId: lea.id,
    targetAccountId: checking.id,
    refundsMovementId: old.id,
  })

  assert.deepEqual(
    (await linkCandidates(user, 'expense', 'lea 60')).map((m) => m.id),
    [old.id],
  )
  assert.deepEqual(
    (await linkCandidates(user, 'income', 'lea')).map((m) => m.id),
    [free.id],
  )
})
