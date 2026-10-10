import { useLocale } from 'next-intl'
import { INTL_LOCALE, type Language, SHORT_MONTH_YEAR } from '@/i18n/config'
import { daysBetween } from '@/lib/utils'

/**
 * How amounts and dates are written, in the language the interface speaks.
 * Every figure on screen goes through here: a `toLocaleString('fr-FR')` left
 * in a component would keep writing French numbers under an English page.
 *
 * Dates arrive as plain calendar days ("2026-10-05") and are formatted in UTC,
 * so that no timezone ever moves a day.
 */
export interface Format {
  /** "1 234 €", "€1,234". */
  eur(value: number | string, decimals?: number): string
  /** An amount in its own currency: "99,00 $US", "$99.00", for what was paid abroad. */
  money(value: number | string, currency: string, decimals?: number): string
  /** Compact money for axis ticks and dense tiles: "13,5 k €" rather than "13 500 €". */
  eurShort(value: number): string
  /** Signed amount, sign always spelled out: it is the reading, not decoration. */
  eurSigned(value: number, decimals?: number): string
  /** A plain number, at most `max` decimals unless a minimum is asked. */
  number(value: number | string, max?: number, min?: number): string
  /** "05/10/26", "10/05/26". */
  date(iso: string): string
  /** "5 octobre 2026", "October 5, 2026". */
  dateLong(iso: string): string
  /** A month, short: "oct. 26", "Oct 2026". */
  month(iso: string): string
  /** "octobre 2026", "October 2026". */
  monthLong(iso: string): string
  /** A month name alone, short and without its trailing dot: "oct", "Oct". */
  monthName(iso: string): string
  /** Freshness of a check or a due date, said the way a person would say it. */
  freshness(iso: string, todayIso: string): string
  /** A calendar day in a shape none of the above gives, such as a month name alone. */
  dateAs(iso: string, options: Intl.DateTimeFormatOptions): string
  /** The Intl locale behind these formatters, for a collator or a display name. */
  locale: string
  /**
   * A number as an editable field shows it: no grouping, the language's
   * decimal mark, trailing zeros dropped so they do not fight the caret.
   */
  editable(value: number, decimals: number): string
  /**
   * What a person typed in a number field, read with the language's marks:
   * spaces and group separators dropped, the decimal mark taken as such. A
   * typed point still reads as a decimal where it is not a group separator.
   * NaN when it is no number.
   */
  parse(text: string): number
}

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1)
}

function build(language: Language): Format {
  const locale = INTL_LOCALE[language]
  const day = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
  const dateShort = day({ day: '2-digit', month: '2-digit', year: '2-digit' })
  const dateLong = day({ day: 'numeric', month: 'long', year: 'numeric' })
  const monthShort = day({ month: 'short', year: SHORT_MONTH_YEAR[language] })
  const monthLong = day({ month: 'long', year: 'numeric' })
  const monthName = day({ month: 'short' })
  const compact = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  const money = (value: number | string, currency: string, decimals = 2) =>
    Number(value).toLocaleString(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  const eur = (value: number | string, decimals = 0) => money(value, 'EUR', decimals)
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  const group = parts.find((p) => p.type === 'group')?.value ?? ''
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'

  return {
    eur,
    money,
    eurShort: (value) => (Math.abs(value) >= 10_000 ? compact.format(value) : eur(value)),
    eurSigned: (value, decimals = 0) => {
      const sign = value > 0 ? '+' : value < 0 ? '−' : ''
      return `${sign}${eur(Math.abs(value), decimals)}`
    },
    number: (value, max = 2, min = 0) =>
      Number(value).toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max }),
    date: (iso) => dateShort.format(utc(iso)),
    dateLong: (iso) => dateLong.format(utc(iso)),
    month: (iso) => monthShort.format(utc(iso)),
    monthLong: (iso) => monthLong.format(utc(iso)),
    monthName: (iso) => monthName.format(utc(iso)).replace('.', ''),
    dateAs: (iso, options) => day(options).format(utc(iso)),
    locale,
    editable: (value, decimals) =>
      Number.isFinite(value)
        ? value
            .toFixed(decimals)
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '')
            .replace('.', decimal)
        : '',
    parse: (text) => {
      let cleaned = text.replace(/\s/g, '')
      if (group.trim() !== '') cleaned = cleaned.split(group).join('')
      if (decimal !== '.') cleaned = cleaned.replace(decimal, '.')
      return cleaned === '' ? Number.NaN : Number(cleaned)
    },
    freshness: (iso, todayIso) => {
      const days = daysBetween(iso, todayIso)
      if (Math.abs(days) < 30) return relative.format(-days, 'day')
      return relative.format(-Math.round(days / 30), 'month')
    },
  }
}

const built = new Map<Language, Format>()

/** The formatters of a language, built once: Intl objects are not free to make. */
export function formatFor(language: Language): Format {
  let format = built.get(language)
  if (!format) {
    format = build(language)
    built.set(language, format)
  }
  return format
}

/** The formatters of the language this render speaks, in a client or a synchronous server component. */
export function useFormat(): Format {
  return formatFor(useLocale())
}
