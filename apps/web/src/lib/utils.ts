import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function eur(value: number | string, decimals = 0): string {
  return `${Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} €`
}

/** An amount in its own currency: "99,00 $US" for what was paid abroad. */
export function money(value: number | string, currency: string, decimals = 2): string {
  return Number(value).toLocaleString('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Compact money for axis ticks and dense tiles: "13,5 k €" rather than "13 500 €". */
export function eurShort(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 10_000) return `${(value / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k €`
  return eur(value)
}

/** Signed amount, sign always spelled out: it is the reading, not decoration. */
export function eurSigned(value: number, decimals = 0): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${eur(Math.abs(value), decimals)}`
}

export function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y!.slice(2)}`
}

/** A month, short: what a movement's attachment reads as next to its date. */
export function frMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

export function frMonthLong(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export function frDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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

/** Freshness of a check or a due date, said the way a person would say it. */
export function freshness(iso: string, todayIso: string): string {
  const d = daysBetween(iso, todayIso)
  if (d < 0) return `dans ${-d} jour${d < -1 ? 's' : ''}`
  if (d === 0) return 'aujourd’hui'
  if (d === 1) return 'hier'
  if (d < 30) return `il y a ${d} jours`
  const months = Math.round(d / 30)
  return months <= 1 ? 'il y a un mois' : `il y a ${months} mois`
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
