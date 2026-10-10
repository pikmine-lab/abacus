import { useTranslations } from 'next-intl'
import { type Format, useFormat } from '@/lib/format'

/**
 * The words the levy vocabulary takes on screen. A rule's own name, its
 * regime label and its threshold sentences come from what the user declared;
 * what is left here are the enums of the model, which need a word each in the
 * interface's language (catalog `regime.words`) and need the same one wherever
 * they show, in Réglages as in the statement.
 *
 * Typed loosely on purpose: the rows these label arrive from the database as
 * plain strings, and narrowing them at every call site would buy nothing. A
 * value the catalog does not know shows as itself rather than breaking.
 */

/** The reference periods a measure can be read over, in the order a list offers them. */
export const LEVY_PERIOD_REFS = ['current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12'] as const

export type LevyWordsT = ReturnType<typeof useTranslations<'regime.words'>>

export interface LevyWords {
  kind(value: string): string
  measure(value: string): string
  periodRef(value: string): string
  period(value: string): string
  effect(value: string): string
  /** Only what is not plainly confirmed gets a badge: a confirmed rule says nothing. */
  status(value: string): { label: string; variant: 'secondary' | 'outline' } | undefined
  /**
   * A threshold's value in its own unit: a share of receipts is a percentage,
   * everything else is money. Read from the measure rather than stated beside
   * it, so the two interfaces cannot disagree on what "70" means.
   */
  thresholdValue(measure: string, value: number | string): string
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline'> = {
  extended_by_default: 'secondary',
  unconfirmed: 'outline',
}

export function levyWords(t: LevyWordsT, format: Format): LevyWords {
  const word = (group: string, value: string) => {
    const key = `${group}.${value}` as Parameters<LevyWordsT>[0]
    return t.has(key) ? t(key) : value
  }
  return {
    kind: (value) => word('kind', value),
    measure: (value) => word('measure', value),
    periodRef: (value) => word('periodRef', value),
    period: (value) => word('period', value),
    effect: (value) => word('effect', value),
    status: (value) => {
      const variant = STATUS_VARIANT[value]
      return variant ? { label: word('status', value), variant } : undefined
    },
    thresholdValue: (measure, value) =>
      measure === 'withholding_share' ? `${format.number(value)} %` : format.eur(Number(value)),
  }
}

/** The levy words of the language this render speaks, in a client or a synchronous server component. */
export function useLevyWords(): LevyWords {
  return levyWords(useTranslations('regime.words'), useFormat())
}
