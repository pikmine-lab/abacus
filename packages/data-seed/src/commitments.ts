import { addPeriod } from '@abacus/core/domain/period'
import {
  cancelCommitment,
  createFinancing,
  createSubscription,
  defaultSchedule,
} from '@abacus/core/services/commitments'
import { addDays, dayOfMonthAgo, daysAgo, firstMonthlyDue, TODAY } from './calendar.ts'
import type { Cards } from './cards.ts'
import type { Ledger } from './ledger.ts'
import { confirmEach, dueDates } from './schedule.ts'

/**
 * What the person has signed up for, each confirmed up to yesterday so the
 * schedule reads as kept. One subscription is left with yesterday's occurrence
 * unconfirmed, so there is always something to confirm.
 */
export async function commitments(userId: string, { accounts, categories, actors }: Ledger, cards: Cards) {
  const yesterday = daysAgo(1)

  const subscription = async (
    input: Omit<Parameters<typeof createSubscription>[1], 'accountId' | 'periodUnit' | 'firstDueOn'> & {
      accountId?: string
      periodUnit?: 'month' | 'year'
      firstDueOn: string
    },
  ) =>
    (
      await createSubscription(userId, {
        accountId: accounts.checking,
        periodUnit: 'month',
        ...input,
      })
    ).id

  // Paid the day before it falls due, so the movement lands in the previous
  // month and the occurrence keeps the month it is about.
  const rentFirst = firstMonthlyDue(1)
  const rent = await subscription({
    label: 'Loyer',
    actorId: actors.landlord,
    categoryId: categories.rent,
    amount: 850,
    firstDueOn: rentFirst,
    judgment: 'essential',
  })
  await confirmEach(userId, rent, dueDates(rentFirst, 'month', 1, TODAY), (dueOn) => ({
    happenedOn: addDays(dueOn, -1),
  }))

  // A price rise four months ago, recorded as the new usual amount.
  const energyFirst = firstMonthlyDue(10)
  const energy = await subscription({
    label: 'Électricité',
    actorId: actors.electricity,
    categoryId: categories.energy,
    amount: 62,
    firstDueOn: energyFirst,
    judgment: 'essential',
  })
  const energyRise = dayOfMonthAgo(4, 10)
  await confirmEach(userId, energy, dueDates(energyFirst, 'month', 1, yesterday), (dueOn) =>
    dueOn === energyRise ? { amount: 68, updateReference: true } : {},
  )

  // Due yesterday and not confirmed yet: the occurrence waiting on every screen.
  const telecomDay = Math.min(Number(yesterday.slice(8)), 28)
  const telecomFirst = firstMonthlyDue(telecomDay)
  const telecom = await subscription({
    label: 'Box et forfait mobile',
    actorId: actors.telecom,
    categoryId: categories.telecom,
    amount: 39.99,
    firstDueOn: telecomFirst,
    judgment: 'essential',
    engagedUntil: addPeriod(TODAY, 'month', 8),
  })
  await confirmEach(userId, telecom, dueDates(telecomFirst, 'month', 1, yesterday).slice(0, -1))

  const insuranceFirst = dayOfMonthAgo(10, 15)
  const insurance = await subscription({
    label: 'Assurance habitation',
    actorId: actors.insurer,
    categoryId: categories.homeInsurance,
    amount: 186,
    periodUnit: 'year',
    firstDueOn: insuranceFirst,
    judgment: 'essential',
  })
  await confirmEach(userId, insurance, dueDates(insuranceFirst, 'year', 1, yesterday))

  const transitFirst = firstMonthlyDue(2)
  const transit = await subscription({
    label: 'Abonnement transports',
    actorId: actors.transit,
    categoryId: categories.transit,
    amount: 75.2,
    firstDueOn: transitFirst,
    judgment: 'essential',
  })
  await confirmEach(userId, transit, dueDates(transitFirst, 'month', 1, yesterday))

  for (const [label, actorId, amount, day, judgment] of [
    ['CinéStream', actors.streaming, 13.49, 12, 'reducible'],
    ['SonoBox', actors.music, 10.99, 20, 'reducible'],
  ] as const) {
    const first = firstMonthlyDue(day)
    const id = await subscription({
      label,
      actorId,
      categoryId: categories.streaming,
      amount,
      firstDueOn: first,
      judgment,
      cardId: cards.deferred,
    })
    await confirmEach(userId, id, dueDates(first, 'month', 1, yesterday))
  }

  const gymFirst = firstMonthlyDue(3)
  const gym = await subscription({
    label: 'Salle de sport',
    actorId: actors.gym,
    categoryId: categories.sport,
    amount: 34.9,
    firstDueOn: gymFirst,
    judgment: 'to_cancel',
    judgmentNote: "Presque pas utilisée depuis l'été",
  })
  await confirmEach(userId, gym, dueDates(gymFirst, 'month', 1, yesterday))

  // Cancelled three months ago: it closes the page, with its date.
  const magazineFirst = firstMonthlyDue(18)
  const cancelledOn = dayOfMonthAgo(3, 20)
  const magazine = await subscription({
    label: 'Journal en ligne',
    actorId: actors.magazine,
    categoryId: categories.streaming,
    amount: 9.99,
    firstDueOn: magazineFirst,
  })
  await confirmEach(userId, magazine, dueDates(magazineFirst, 'month', 1, cancelledOn))
  await cancelCommitment(userId, magazine, cancelledOn)

  // A raise six months ago becomes the usual amount; a bonus three months ago
  // is a one-off, and stays one.
  const salaryFirst = firstMonthlyDue(28)
  const salary = await subscription({
    label: 'Salaire',
    actorId: actors.employer,
    categoryId: categories.salary,
    direction: 'incoming',
    amount: 2650,
    firstDueOn: salaryFirst,
  })
  const raise = dayOfMonthAgo(6, 28)
  const bonus = dayOfMonthAgo(3, 28)
  await confirmEach(userId, salary, dueDates(salaryFirst, 'month', 1, yesterday), (dueOn) =>
    dueOn === raise ? { amount: 2720, updateReference: true } : dueOn === bonus ? { amount: 3450 } : {},
  )

  const parkingFirst = firstMonthlyDue(5)
  const parking = await subscription({
    label: 'Location du parking',
    actorId: actors.tenant,
    categoryId: categories.rentalIncome,
    direction: 'incoming',
    amount: 75,
    firstDueOn: parkingFirst,
  })
  await confirmEach(userId, parking, dueDates(parkingFirst, 'month', 1, yesterday))

  // A financing under way, and one already paid off.
  const bikeFirst = dayOfMonthAgo(8, 8)
  const bike = await createFinancing(userId, {
    label: 'Vélo électrique',
    actorId: actors.lender,
    accountId: accounts.checking,
    categoryId: categories.bike,
    installmentsTotal: 12,
    totalAmount: 1800,
    firstDueOn: bikeFirst,
  })
  await confirmEach(userId, bike.id, dueDates(bikeFirst, 'month', 1, yesterday))

  const phoneSchedule = defaultSchedule({
    totalAmount: 599,
    installmentsTotal: 4,
    firstDueOn: dayOfMonthAgo(11, 14),
  })
  const phone = await createFinancing(userId, {
    label: 'Smartphone en 4 fois',
    actorId: actors.telecom,
    accountId: accounts.checking,
    categoryId: categories.telecom,
    installmentsTotal: 4,
    totalAmount: 599,
    firstDueOn: phoneSchedule[0]!.dueOn,
    cardId: cards.deferred,
  })
  await confirmEach(
    userId,
    phone.id,
    phoneSchedule.map((line) => line.dueOn),
  )
}
