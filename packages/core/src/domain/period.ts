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

/** Today as a calendar date, in the server's timezone. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
