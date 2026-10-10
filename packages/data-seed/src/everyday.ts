import { closeAccount } from '@abacus/core/services/accounts'
import { declareMovement, refundAdvance } from '@abacus/core/services/movements'
import {
  addDays,
  amountBetween,
  dayOfMonthAgo,
  daysAgo,
  HISTORY_START,
  historyDays,
  random,
  weekday,
} from './calendar.ts'
import type { Cards } from './cards.ts'
import type { Ledger } from './ledger.ts'

/**
 * A year of ordinary life on the current account: groceries, bread, a
 * restaurant now and then, mostly on the deferred card. The rhythm is fixed
 * and the amounts come from a seeded generator, so the history is lively
 * without being random from one run to the next.
 */
export async function everyday(userId: string, { accounts, categories, actors }: Ledger, cards: Cards) {
  const next = random(147)
  const spend = (
    happenedOn: string,
    targetActorId: string,
    categoryId: string,
    amount: number,
    extra: Partial<Parameters<typeof declareMovement>[1]> = {},
  ) =>
    declareMovement(userId, {
      happenedOn,
      amount,
      sourceAccountId: accounts.checking,
      targetActorId,
      categoryId,
      cardId: cards.deferred,
      ...extra,
    })

  for (const day of historyDays()) {
    const dow = weekday(day)
    const dom = Number(day.slice(8))
    if (dow === 6) await spend(day, actors.supermarket, categories.groceries, amountBetween(next, 55, 120))
    if (dow === 3) await spend(day, actors.grocer, categories.groceries, amountBetween(next, 12, 38))
    if ([1, 3, 5, 0].includes(dow) && next() < 0.7)
      await spend(day, actors.bakery, categories.groceries, amountBetween(next, 2.2, 9.5))
    if (dow === 5 && next() < 0.6) {
      const place = [actors.bistro, actors.pizzeria, actors.cafe][Math.floor(next() * 3)]!
      await spend(day, place, categories.restaurants, amountBetween(next, 16, 52))
    }
    if (dom === 17 && next() < 0.6)
      await spend(day, actors.pharmacy, categories.health, amountBetween(next, 7, 34))
    if (dom === 9 && next() < 0.35)
      await spend(day, actors.clothing, categories.clothing, amountBetween(next, 35, 140))
    if (dom === 22 && next() < 0.3)
      await spend(day, actors.train, categories.train, amountBetween(next, 28, 96), { cardId: undefined })
    // Every month on the 5th, part of the salary goes to savings.
    if (dom === 5)
      await declareMovement(userId, {
        happenedOn: day,
        amount: 600,
        sourceAccountId: accounts.checking,
        targetAccountId: accounts.savings,
      })
  }

  // A long weekend in London five months ago, paid in pounds: the bank's euro
  // figure is given, as it shows on the statement.
  const trip = dayOfMonthAgo(5, 11)
  for (const [offset, actorId, pounds, euros] of [
    [0, actors.londonHotel, 312, 364.21],
    [1, actors.londonMuseum, 24.5, 28.6],
    [1, actors.londonPub, 41.8, 48.79],
  ] as const)
    await spend(addDays(trip, offset), actorId, categories.travel, pounds, {
      currency: 'GBP',
      eurAmount: euros,
    })

  // A dinner and a concert shared with a friend: the dinner was paid back, the
  // concert is still owed and leads the movements screen.
  const repaid = await spend(dayOfMonthAgo(2, 6), actors.bistro, categories.restaurants, 96, {
    expectedRefundFromActorId: actors.friend,
    expectedRefundAmount: 48,
  })
  await refundAdvance(userId, repaid.id, { on: dayOfMonthAgo(2, 19) })
  await spend(daysAgo(12), actors.concert, categories.outings, 120, {
    expectedRefundFromActorId: actors.friend,
    expectedRefundAmount: 60,
  })

  // A birthday gift: it reached the account but says nothing about the flows.
  await declareMovement(userId, {
    happenedOn: dayOfMonthAgo(4, 21),
    amount: 150,
    sourceActorId: actors.family,
    targetAccountId: accounts.checking,
    categoryId: categories.gifts,
    ghost: true,
    note: "Cadeau d'anniversaire",
  })

  // An old joint account, emptied into the current one and closed.
  const emptied = addDays(HISTORY_START, 20)
  await declareMovement(userId, {
    happenedOn: emptied,
    amount: 320,
    sourceAccountId: accounts.joint,
    targetAccountId: accounts.checking,
  })
  await closeAccount(userId, accounts.joint, addDays(emptied, 1))
}
