import { LANGUAGES, type Language } from '@abacus/core/domain'

/**
 * The languages the interface speaks, and how each one writes numbers and
 * dates. The list itself belongs to the domain, whose check constraint holds
 * the preference to it; a language is added there, by a catalog under
 * `messages/`, and by one line in each map keyed by language, never in a
 * component.
 */

export { LANGUAGES, type Language }

/** What the interface speaks when neither the person nor their browser names a language it has. */
export const DEFAULT_LANGUAGE: Language = 'fr'

/** The Intl locale a language formats amounts and dates in. */
export const INTL_LOCALE: Record<Language, string> = {
  fr: 'fr-FR',
  en: 'en-US',
}

/**
 * The year beside a short month. Two digits read as a year in French
 * ("oct. 26"); in English "Oct 26" reads as a day, so the year is written out.
 */
export const SHORT_MONTH_YEAR: Record<Language, '2-digit' | 'numeric'> = {
  fr: '2-digit',
  en: 'numeric',
}

/** The choice that hands the language back to the browser, stored as no choice at all. */
export const BROWSER_LANGUAGE = 'browser'

/** Each language named in itself, so that someone lost in a language they do not read still finds theirs. */
export const LANGUAGE_NAME: Record<Language, string> = {
  fr: 'Français',
  en: 'English',
}

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value)
}

/**
 * The first language of an Accept-Language header the interface speaks, by
 * the browser's own order of preference. Only the primary subtag counts:
 * someone asking for en-GB is better served by English than by the default.
 */
export function negotiateLanguage(header: string | null): Language | undefined {
  if (!header) return undefined
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { primary: tag.split('-')[0]!.toLowerCase(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  return ranked.map((entry) => entry.primary).find(isLanguage)
}
