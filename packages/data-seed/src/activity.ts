import { activityStatement, confirmLevyPayment } from '@abacus/core/services/activityStatement'
import { createActor } from '@abacus/core/services/actors'
import { createSubscription } from '@abacus/core/services/commitments'
import { declareInvoice, settleInvoice } from '@abacus/core/services/invoices'
import { declareMovement } from '@abacus/core/services/movements'
import { applyRegime } from '@abacus/core/services/regimes'
import {
  addDays,
  amountBetween,
  dayOfMonthAgo,
  daysAgo,
  firstMonthlyDue,
  HISTORY_START,
  random,
  TODAY,
} from './calendar.ts'
import type { Cards } from './cards.ts'
import type { Ledger } from './ledger.ts'
import { confirmEach, dueDates } from './schedule.ts'

/**
 * A consulting side activity under a regime model of the catalog: the model is
 * public reference data shipped with the app, and applying it is exactly what a
 * person does from the activity screen. Clients are invoiced every month and
 * mostly pay within the month; one invoice is overdue and one waits for its
 * due date. The levies the regime computes are paid when their window closes.
 */
export async function activity(userId: string, { accounts, categories }: Ledger, cards: Cards) {
  const next = random(82)
  const { activity } = await applyRegime(userId, {
    name: 'Conseil indépendant',
    modelId: 'fr-micro-flat',
    answers: {
      activity_nature: 'liberal_bnc',
      income_tax: 'flat',
      declaration_period: 'quarter',
      vat: 'franchise',
      acre: 'no',
    },
    startedOn: HISTORY_START,
    accountIds: [accounts.business],
  })

  // Clients and suppliers carry the activity, so their movements inherit it.
  const actor = async (name: string) => (await createActor(userId, { name, activityId: activity.id })).id
  const clients = [await actor('Studio Nord'), await actor('Maison Vela'), await actor('Collectif Brique')]
  const office = await actor('Nuage Bureautique')
  const bank = await actor('Néobanque Démo')
  const hardware = await actor('Informatique Express')
  const urssaf = (await createActor(userId, { name: 'Urssaf' })).id

  // One invoice a month, issued on the 3rd, due 30 days later. All but the last
  // two months are settled; of those two, one is past due and one is not yet.
  for (let months = 11; months >= 0; months--) {
    const issuedOn = dayOfMonthAgo(months, 3)
    if (issuedOn >= TODAY) continue
    const invoice = await declareInvoice(userId, {
      activityId: activity.id,
      actorId: clients[months % clients.length]!,
      reference: `F-${issuedOn.slice(0, 7)}`,
      issuedOn,
      dueOn: addDays(issuedOn, 30),
      baseAmount: Math.round(amountBetween(next, 1800, 3400)),
    })
    const paidOn = addDays(issuedOn, 12 + Math.floor(next() * 20))
    if (months >= 2 && paidOn < TODAY)
      await settleInvoice(userId, invoice.id, { accountId: accounts.business, date: paidOn })
  }

  for (const [label, actorId, categoryId, amount, day, cardId] of [
    ['Suite bureautique', office, categories.software, 14.4, 2, cards.business],
    ['Tenue de compte pro', bank, categories.bankFees, 4.9, 1, undefined],
  ] as const) {
    const first = firstMonthlyDue(day)
    const { id } = await createSubscription(userId, {
      label,
      actorId,
      accountId: accounts.business,
      categoryId,
      activityId: activity.id,
      amount,
      periodUnit: 'month',
      firstDueOn: first,
      cardId,
    })
    await confirmEach(userId, id, dueDates(first, 'month', 1, daysAgo(1)))
  }

  await declareMovement(userId, {
    happenedOn: dayOfMonthAgo(7, 16),
    amount: 1290,
    sourceAccountId: accounts.business,
    targetActorId: hardware,
    categoryId: categories.equipment,
    cardId: cards.business,
    note: 'Ordinateur portable',
  })

  // What the activity pays its owner, once a month.
  for (const day of dueDates(firstMonthlyDue(15), 'month', 1, daysAgo(1)))
    await declareMovement(userId, {
      happenedOn: day,
      amount: 1300,
      sourceAccountId: accounts.business,
      targetAccountId: accounts.checking,
    })

  // Every levy whose payment window has closed is paid near its end, at the
  // amount the regime estimated. The ones still open stay to be paid.
  for (const year of new Set([Number(HISTORY_START.slice(0, 4)), Number(TODAY.slice(0, 4))])) {
    const { schedule } = await activityStatement(userId, activity.id, year)
    for (const entry of schedule) {
      if (entry.status !== 'overdue' || entry.amount <= 0 || entry.missingInputs.length > 0) continue
      const lateInWindow = addDays(entry.payment.to, -3)
      await confirmLevyPayment(userId, {
        levyId: entry.levyId,
        periodStart: entry.period.from,
        entry: entry.entry,
        instalment: entry.instalment,
        amount: Math.round(entry.amount * 100) / 100,
        date: lateInWindow < entry.payment.from ? entry.payment.from : lateInWindow,
        accountId: accounts.business,
        actorId: urssaf,
      })
    }
  }
}
