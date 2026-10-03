/**
 * How many months a period's spending is spread over, to read it as a monthly
 * pace. Null when the window holds a month or less: its pace is its total.
 *
 * The window is what was actually lived in it: it starts no earlier than the
 * first declaration (« Tout » reaches back to 1970) and ends no later than
 * today (the running year is not twelve months yet).
 *
 * Read by date, the count is the window's length in days over an average
 * month, so « 12 derniers mois » spreads over twelve and « 90 jours » over
 * about three, not over the thirteen and four calendar months they touch.
 * Read by attachment, a movement belongs to a whole month, so the count is
 * the whole months the window covers, which is what was summed, the running
 * month counting for the part of it already lived.
 */
export function paceMonths(
  period: { from: string; to: string },
  firstDeclaredDay: string | null,
  today: string,
  reading: 'cash' | 'accrual',
): number | null {
  if (firstDeclaredDay === null) return null
  const from = period.from > firstDeclaredDay ? period.from : firstDeclaredDay
  const to = period.to < today ? period.to : today
  if (from > to) return null
  const touched = monthIndex(to) - monthIndex(from) + 1
  // A running month has only been lived up to today: counted whole, it would
  // spread the period over a month that has barely started.
  const last = to === today ? Number(to.slice(8, 10)) / daysInMonth(to) : 1
  const months =
    reading === 'accrual' ? touched - 1 + last : (dayIndex(to) - dayIndex(from) + 1) / DAYS_PER_MONTH
  // A window inside one month is that month, whatever its length in days.
  return touched > 1 && months > 1 ? months : null
}

/** An average month of the Gregorian calendar. */
const DAYS_PER_MONTH = 365.2425 / 12

function dayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!) / 86_400_000
}

function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

function monthIndex(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return y! * 12 + (m! - 1)
}
