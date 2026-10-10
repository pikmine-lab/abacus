import { addPeriod, today } from '@abacus/core/domain/period'

/**
 * Every date of the demo is read off the day the seed runs, never written
 * down: a fixed date ages, and a screen that reads "the last 30 days" or "due
 * this month" would show nothing a few weeks later. Amounts and names stay
 * fixed; only the calendar moves.
 */
export const TODAY = today()

/** How far back the history goes: a full year, so every yearly reading has something to show. */
const HISTORY_MONTHS = 12

/** The day the history opens: every account states what it held on it, and nothing happens before. */
export const HISTORY_START = addPeriod(TODAY, 'month', -HISTORY_MONTHS)

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function daysAgo(days: number): string {
  return addDays(TODAY, -days)
}

/** The given day of the month that lies `months` before the current one, clamped to its end. */
export function dayOfMonthAgo(months: number, day: number): string {
  // addPeriod clamps the day to the target month, so day 31 reads "end of month".
  return addPeriod(`${TODAY.slice(0, 8)}${String(day).padStart(2, '0')}`, 'month', -months)
}

/**
 * The first occurrence of a monthly day inside the history window, a day of
 * margin past its opening (a rent paid the day before it falls due): where a
 * commitment that has been running all year starts its schedule.
 */
export function firstMonthlyDue(day: number): string {
  const candidate = dayOfMonthAgo(HISTORY_MONTHS, day)
  return candidate > addDays(HISTORY_START, 1) ? candidate : dayOfMonthAgo(HISTORY_MONTHS - 1, day)
}

/** Every day of the history window, oldest first, today excluded. */
export function historyDays(): string[] {
  const days: string[] = []
  for (let day = addDays(HISTORY_START, 1); day < TODAY; day = addDays(day, 1)) days.push(day)
  return days
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/**
 * A seeded generator (mulberry32), so a run on a given day always writes the
 * same history: a screen that looked wrong yesterday can be found again.
 */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An amount between two bounds, to the cent. */
export function amountBetween(next: () => number, min: number, max: number): number {
  return Math.round((min + next() * (max - min)) * 100) / 100
}
