import type { Reading } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import type { useTranslations } from 'next-intl'
import type { Format } from '@/lib/format'

/**
 * The period a view is scoped to, resolved from the URL so it survives a
 * reload, a shared link and the back button, and so server components can
 * read it without any client state. One row of filters scopes everything
 * below it (DESIGN.md); this is where that row's meaning lives.
 */
export type Preset = 'month' | 'year' | '90d' | '12m' | 'all' | 'range'

export interface Period {
  preset: Preset
  /** Anchor of the calendar presets: "YYYY-MM" for a month, "YYYY" for a year. */
  ref: string
  from: string
  to: string
  /** Named for a sentence, in the interface's language: "août 2026", "90 derniers jours". */
  label: string
  /** Anchor of the previous/next window, or null when there is nowhere to go. */
  prev: string | null
  next: string | null
}

const PRESETS: Preset[] = ['month', 'year', '90d', '12m', 'all', 'range']

function isDay(value: string | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

/**
 * What a period needs to name itself: the `common.period` words and the
 * formatters of the language being spoken. Resolved on the server, the label
 * then travels as plain text to whatever displays it.
 */
export interface PeriodWords {
  t: ReturnType<typeof useTranslations<'common.period'>>
  format: Format
}

/**
 * A window nothing on the picker can express, carried whole in the anchor
 * ("YYYY-MM-DD..YYYY-MM-DD"). A fiscal year opening on 6 April is such a
 * window: without it the figures of an activity would lead to a ledger framed
 * on some other span, which is worse than leading nowhere.
 */
export function rangeRef(from: string, to: string): string {
  return `${from}..${to}`
}

/** Presets that slide along the calendar, and therefore get arrows. */
export function isNavigable(preset: Preset): boolean {
  return preset === 'month' || preset === 'year'
}

/**
 * A period as the URL carries it, for a link that opens another screen on the
 * same window. The preset travels rather than its two dates, so the screen
 * reached names the window as the one left did. The other presets resolve
 * from today alone and need no ref.
 */
export function periodParams(period: Period): string {
  const anchored = isNavigable(period.preset) || period.preset === 'range'
  return `period=${period.preset}${anchored ? `&ref=${period.ref}` : ''}`
}

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
  { t, format }: PeriodWords,
  params: { period?: string; ref?: string },
  now = today(),
  /** What the view means by "no period chosen": a ledger wants a wider one. */
  fallback: Preset = 'month',
): Period {
  const preset = (PRESETS as string[]).includes(params.period ?? '') ? (params.period as Preset) : fallback

  if (preset === 'range') {
    const [from, to] = (params.ref ?? '').split('..')
    if (isDay(from) && isDay(to) && from! <= to!)
      return {
        preset,
        ref: params.ref!,
        from: from!,
        to: to!,
        label: t('range', { from: format.date(from!), to: format.date(to!) }),
        prev: null,
        next: null,
      }
  }
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
      label:
        ref === currentMonth
          ? t('current', { name: format.dateAs(from, { month: 'long' }) })
          : format.monthLong(from),
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
      label: ref === currentYear ? t('current', { name: ref }) : ref,
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
      label: t('last90'),
      prev: null,
      next: null,
    }

  if (preset === '12m')
    return {
      preset,
      ref: now,
      from: daysBack(365, now),
      to: now,
      label: t('last12'),
      prev: null,
      next: null,
    }

  return {
    preset: 'all',
    ref: now,
    // Far enough back to hold any declared history without a query per view.
    from: '1970-01-01',
    to: now,
    label: t('sinceStart'),
    prev: null,
    next: null,
  }
}

/**
 * The window a period is compared against: the same length, immediately
 * before. Null for "tout", which has nothing before it: a delta against an
 * empty window would read as a collapse rather than as "no comparison".
 */
export function previousWindow(
  { t, format }: PeriodWords,
  period: Period,
): { from: string; to: string; label: string } | null {
  if (period.preset === 'all') return null
  if (period.preset === 'month') {
    const ref = shiftMonth(period.ref, -1)
    const [y, m] = ref.split('-').map(Number)
    return {
      from: `${ref}-01`,
      to: `${ref}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}`,
      label: t('versus', { name: format.dateAs(`${ref}-01`, { month: 'long' }) }),
    }
  }
  if (period.preset === 'year') {
    const ref = String(Number(period.ref) - 1)
    return { from: `${ref}-01-01`, to: `${ref}-12-31`, label: t('versus', { name: ref }) }
  }
  const span = daysSpan(period.from, period.to)
  const to = shiftDays(period.from, -1)
  const label =
    period.preset === '90d'
      ? t('versusPrevious90')
      : period.preset === '12m'
        ? t('versusPrevious12')
        : t('versusPrevious')
  return { from: shiftDays(to, -(span - 1)), to, label }
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
 * rows; clamping it to the first declared day asks for the same data without
 * the void in front of it.
 */
export function seriesFrom(period: Period, firstDeclaredDay: string | null): string {
  if (!firstDeclaredDay) return period.to
  return period.from > firstDeclaredDay ? period.from : firstDeclaredDay
}

/**
 * What a flow figure says about its reading, when it has to say anything.
 * Under cash, nothing: the period in the title is what was read. Under accrual
 * the reading is named, because the same month has two legitimate totals; and
 * a rolling window also names the whole months it covers, because an
 * attachment holds a month and nothing finer, so "90 derniers jours" is not
 * what was answered.
 */
export function readingQualifier(
  { t, format }: PeriodWords,
  period: Period,
  reading: Reading,
): string | undefined {
  if (reading === 'cash') return undefined
  if (period.preset === 'month' || period.preset === 'year' || period.preset === 'all') return t('accrual')
  const from = format.dateAs(period.from, { month: 'short', year: 'numeric' })
  const to = format.dateAs(period.to, { month: 'short', year: 'numeric' })
  return t('accrualOver', { months: from === to ? from : `${from} → ${to}` })
}
