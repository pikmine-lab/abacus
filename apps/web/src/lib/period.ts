import { today } from '@abacus/core/domain/period'

/**
 * The period a view is scoped to, resolved from the URL so it survives a
 * reload, a shared link and the back button, and so server components can
 * read it without any client state. One row of filters scopes everything
 * below it (DESIGN.md); this is where that row's meaning lives.
 */
export type Preset = 'mois' | 'annee' | '90j' | '12m' | 'tout'

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

const PRESETS: Preset[] = ['mois', 'annee', '90j', '12m', 'tout']

export const PRESET_LABEL: Record<Preset, string> = {
  mois: 'Mois',
  annee: 'Année',
  '90j': '90 jours',
  '12m': '12 mois',
  tout: 'Tout',
}

/** Presets that slide along the calendar, and therefore get arrows. */
export function isNavigable(preset: Preset): boolean {
  return preset === 'mois' || preset === 'annee'
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
  params: { periode?: string; ref?: string },
  now = today(),
  /** What the view means by "no period chosen": a ledger wants a wider one. */
  fallback: Preset = 'mois',
): Period {
  const preset = (PRESETS as string[]).includes(params.periode ?? '') ? (params.periode as Preset) : fallback
  const currentMonth = now.slice(0, 7)
  const currentYear = now.slice(0, 4)

  if (preset === 'mois') {
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

  if (preset === 'annee') {
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

  if (preset === '90j')
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
    preset: 'tout',
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
  if (period.preset === 'tout') return null
  if (period.preset === 'mois') {
    const ref = shiftMonth(period.ref, -1)
    const [y, m] = ref.split('-').map(Number)
    return {
      from: `${ref}-01`,
      to: `${ref}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}`,
      label: `vs ${MONTHS[m! - 1]}`,
    }
  }
  if (period.preset === 'annee') {
    const ref = String(Number(period.ref) - 1)
    return { from: `${ref}-01-01`, to: `${ref}-12-31`, label: `vs ${ref}` }
  }
  const span = daysSpan(period.from, period.to)
  const to = shiftDays(period.from, -1)
  return {
    from: shiftDays(to, -(span - 1)),
    to,
    label: period.preset === '90j' ? 'vs 90 jours avant' : 'vs 12 mois avant',
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

/** Number of months the period spans, for "≈ x €/mois" readings. */
export function monthsInPeriod(period: Period): number {
  if (period.preset === 'mois') return 1
  if (period.preset === 'annee') return 12
  const [fy, fm] = period.from.split('-').map(Number)
  const [ty, tm] = period.to.split('-').map(Number)
  return Math.max(1, (ty! - fy!) * 12 + (tm! - fm!) + 1)
}
