import type { Reading } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'

/**
 * The period a view is scoped to, resolved from the URL so it survives a
 * reload, a shared link and the back button, and so server components can
 * read it without any client state. One row of filters scopes everything
 * below it (DESIGN.md); this is where that row's meaning lives.
 */
export type Preset = 'month' | 'year' | '90d' | '12m' | 'all'

export interface Period {
  preset: Preset
  /** Anchor of the calendar presets: "YYYY-MM" for a month, "YYYY" for a year. */
  ref: string
  from: string
  to: string
  /** Named for a sentence: "dépensé en août", "sur les 90 derniers jours". */
  label: string
  /** Anchor of the previous/next window, or null when there is nowhere to go. */
  prev: string | null
  next: string | null
}

const PRESETS: Preset[] = ['month', 'year', '90d', '12m', 'all']

export const PRESET_LABEL: Record<Preset, string> = {
  month: 'Mois',
  year: 'Année',
  '90d': '90 jours',
  '12m': '12 mois',
  all: 'Tout',
}

/** Presets that slide along the calendar, and therefore get arrows. */
export function isNavigable(preset: Preset): boolean {
  return preset === 'month' || preset === 'year'
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function shiftMonth(ref: string, by: number): string {
  const [y, m] = ref.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + by
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Days back from today, inclusive of today. */
function daysBack(count: number, to: string): string {
  const [y, m, d] = to.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! - count + 1))
  return t.toISOString().slice(0, 10)
}

export function resolvePeriod(
  params: { period?: string; ref?: string },
  now = today(),
  /** What the view means by "no period chosen": a ledger wants a wider one. */
  fallback: Preset = 'month',
): Period {
  const preset = (PRESETS as string[]).includes(params.period ?? '') ? (params.period as Preset) : fallback
  const currentMonth = now.slice(0, 7)
  const currentYear = now.slice(0, 4)

  if (preset === 'month') {
    const ref = /^\d{4}-\d{2}$/.test(params.ref ?? '') ? params.ref! : currentMonth
    const [y, m] = ref.split('-').map(Number)
    const from = `${ref}-01`
    const to = `${ref}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}`
    const next = shiftMonth(ref, 1)
    return {
      preset,
      ref,
      from,
      to,
      label: ref === currentMonth ? `${MONTHS[m! - 1]} (en cours)` : `${MONTHS[m! - 1]} ${y}`,
      prev: shiftMonth(ref, -1),
      next: next > currentMonth ? null : next,
    }
  }

  if (preset === 'year') {
    const ref = /^\d{4}$/.test(params.ref ?? '') ? params.ref! : currentYear
    const next = String(Number(ref) + 1)
    return {
      preset,
      ref,
      from: `${ref}-01-01`,
      to: `${ref}-12-31`,
      label: ref === currentYear ? `${ref} (en cours)` : ref,
      prev: String(Number(ref) - 1),
      next: next > currentYear ? null : next,
    }
  }

  if (preset === '90d')
    return {
      preset,
      ref: now,
      from: daysBack(90, now),
      to: now,
      label: '90 derniers jours',
      prev: null,
      next: null,
    }

  if (preset === '12m')
    return {
      preset,
      ref: now,
      from: daysBack(365, now),
      to: now,
      label: '12 derniers mois',
      prev: null,
      next: null,
    }

  return {
    preset: 'all',
    ref: now,
    // Far enough back to hold any declared history without a query per view.
    from: '1970-01-01',
    to: now,
    label: 'depuis le début',
    prev: null,
    next: null,
  }
}

/**
 * The window a period is compared against: the same length, immediately
 * before. Null for "tout", which has nothing before it: a delta against an
 * empty window would read as a collapse rather than as "no comparison".
 */
export function previousWindow(period: Period): { from: string; to: string; label: string } | null {
  if (period.preset === 'all') return null
  if (period.preset === 'month') {
    const ref = shiftMonth(period.ref, -1)
    const [y, m] = ref.split('-').map(Number)
    return {
      from: `${ref}-01`,
      to: `${ref}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}`,
      label: `vs ${MONTHS[m! - 1]}`,
    }
  }
  if (period.preset === 'year') {
    const ref = String(Number(period.ref) - 1)
    return { from: `${ref}-01-01`, to: `${ref}-12-31`, label: `vs ${ref}` }
  }
  const span = daysSpan(period.from, period.to)
  const to = shiftDays(period.from, -1)
  return {
    from: shiftDays(to, -(span - 1)),
    to,
    label: period.preset === '90d' ? 'vs 90 jours avant' : 'vs 12 mois avant',
  }
}

function shiftDays(iso: string, by: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + by)).toISOString().slice(0, 10)
}

function daysSpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000) + 1
}

/**
 * Start day to ask a day-by-day or month-by-month series for. The open-ended
 * preset reaches back to the epoch, which would generate thousands of empty
 * rows; clamping it to the first declared movement asks for the same data
 * without the void in front of it.
 */
export function seriesFrom(period: Period, firstMovementDay: string | null): string {
  if (!firstMovementDay) return period.to
  return period.from > firstMovementDay ? period.from : firstMovementDay
}

const SHORT_MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

/**
 * Which month a movement counts in, read from the URL like the period itself:
 * the day the money moved, or the month it is about. Absent means cash, so a
 * link written before this existed keeps its meaning.
 */
export function resolveReading(params: { reading?: string }): Reading {
  return params.reading === 'accrual' ? 'accrual' : 'cash'
}

/**
 * The period as the chosen reading actually read it, named. Under cash it is
 * the period's own label. Under accrual two things change and both have to
 * show: the reading is named, because the same month has two legitimate
 * totals; and a rolling window is renamed after the whole months it covers,
 * because an attachment holds a month and nothing finer, so "90 derniers
 * jours" is not what was answered.
 */
export function readingLabel(period: Period, reading: Reading): string {
  if (reading === 'cash') return period.label
  const covered = monthsCovered(period)
  // A label already carrying a remark ("août (en cours)") takes this one in the
  // same parenthesis: two of them in a row read as a stutter.
  return covered.endsWith(')') ? `${covered.slice(0, -1)}, rattachement)` : `${covered} (rattachement)`
}

function monthsCovered(period: Period): string {
  if (period.preset === 'month' || period.preset === 'year' || period.preset === 'all') return period.label
  const from = shortMonth(period.from)
  const to = shortMonth(period.to)
  return from === to ? from : `${from} → ${to}`
}

function shortMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${SHORT_MONTHS[m! - 1]} ${y}`
}

/** Number of months the period spans, for "≈ x €/mois" readings. */
export function monthsInPeriod(period: Period): number {
  if (period.preset === 'month') return 1
  if (period.preset === 'year') return 12
  const [fy, fm] = period.from.split('-').map(Number)
  const [ty, tm] = period.to.split('-').map(Number)
  return Math.max(1, (ty! - fy!) * 12 + (tm! - fm!) + 1)
}
