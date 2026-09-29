import { endOfMonth } from './period.ts'
import type { Card, DayShift } from './types.ts'

/** A deferred card's schedule, as the card stores it. */
export type CardSchedule = Pick<Card, 'statementDay' | 'statementShift' | 'debitDay' | 'debitShift'>

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * A day of a given month, clamped to its last day (31 reads "end of month"),
 * then moved off a weekend when the card says so. The weekend is Saturday and
 * Sunday, the days the interbank payment systems are closed.
 */
function scheduledDay(year: number, month: number, day: number, shift: DayShift): string {
  const last = Number(endOfMonth(`${year}-${String(month).padStart(2, '0')}-01`).slice(8))
  const date = new Date(Date.UTC(year, month - 1, Math.min(day, last)))
  const weekday = date.getUTCDay()
  if (shift === 'previous' && weekday === 6) date.setUTCDate(date.getUTCDate() - 1)
  if (shift === 'previous' && weekday === 0) date.setUTCDate(date.getUTCDate() - 2)
  if (shift === 'next' && weekday === 6) date.setUTCDate(date.getUTCDate() + 2)
  if (shift === 'next' && weekday === 0) date.setUTCDate(date.getUTCDate() + 1)
  return iso(date)
}

/**
 * The first occurrence of a monthly day that falls on or after a date. The
 * scan starts a month early because a weekend shift can carry a month's day
 * into the next one (the 31st moved to Monday the 2nd). Shifted days never
 * move by more than two days, so the occurrences stay in order and the first
 * one reached is the one.
 */
function firstOnOrAfter(date: string, day: number, shift: DayShift): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  for (let offset = -1; ; offset++) {
    const total = y * 12 + (m - 1) + offset
    const candidate = scheduledDay(Math.floor(total / 12), (total % 12) + 1, day, shift)
    if (candidate >= date) return candidate
  }
}

/**
 * The cycle a purchase on a deferred card belongs to: the cut-off that closes
 * it, the first one on or after the purchase day, since a purchase made on the
 * cut-off day still belongs to that cycle; and the debit the schedule expects,
 * the first debit day on or after that cut-off. A card cut off on the 25th and
 * debited on the last day of the month expects a purchase of September 26th to
 * be debited on October 31st; one cut off at the end of the month and debited
 * on the 1st expects a purchase of September 30th on October 1st.
 */
export function cycleOf(schedule: CardSchedule, purchasedOn: string): { cutOffOn: string; dueOn: string } {
  const cutOffOn = firstOnOrAfter(purchasedOn, schedule.statementDay!, schedule.statementShift!)
  return { cutOffOn, dueOn: firstOnOrAfter(cutOffOn, schedule.debitDay!, schedule.debitShift!) }
}

/** The debit a deferred card's schedule expects for a purchase. */
export function debitDateOf(schedule: CardSchedule, purchasedOn: string): string {
  return cycleOf(schedule, purchasedOn).dueOn
}

/** Whether a card still works on a day: through the last day of its printed month. */
export function isValidOn(card: Pick<Card, 'expiryMonth'>, on: string): boolean {
  return on <= endOfMonth(card.expiryMonth)
}
