import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Same clamping as the domain's addPeriod: the 31st lands on the 28th in
 * February rather than sliding into March.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const shifted = m! - 1 + months
  const year = y! + Math.floor(shifted / 12)
  const monthIndex = ((shifted % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const day = String(Math.min(d!, lastDay)).padStart(2, '0')
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day}`
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

/** Whole days between two calendar dates, both read as plain days (no timezone). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accepts a URL parameter only if it could be an id. Filters come from the
 * address bar, where a stale link or a hand-edited value would otherwise reach
 * Postgres and fail the whole page on a cast error.
 */
export function idParam(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined
}

/**
 * The filter value asking for what carries nothing on a dimension (no
 * category, no activity), where an id would name one.
 */
export const NONE = 'none'
