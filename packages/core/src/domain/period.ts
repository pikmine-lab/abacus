import type { PeriodUnit } from './types.ts'

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month, month being 1-based here.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Adds a commitment period to a calendar date. Month (and year) additions
 * clamp to the end of the month: a subscription billed on the 31st falls on
 * February 28th, not March 3rd.
 */
export function addPeriod(date: string, unit: PeriodUnit, count: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  if (unit === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * count))
    return t.toISOString().slice(0, 10)
  }
  const months = unit === 'month' ? count : 12 * count
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(d, daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The last day of the month a date falls in. */
export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`
}

/** Today as a calendar date, in the server's timezone. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The day before a calendar date. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/**
 * The fiscal year a day falls in, for an activity whose year opens on a given
 * month and day (1 January nearly everywhere, 6 April in the UK): its first
 * and last day. Every "this year" an activity screen speaks of is this one.
 */
export function fiscalYearOf(
  day: string,
  startMonth: number,
  startDay: number,
): { from: string; to: string } {
  const year = Number(day.slice(0, 4))
  const opening = (y: number) =>
    `${y}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`
  const from = day >= opening(year) ? opening(year) : opening(year - 1)
  return { from, to: dayBefore(addPeriod(from, 'year', 1)) }
}
