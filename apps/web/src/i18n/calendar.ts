import type { Locale } from 'react-day-picker'
import { enUS, fr } from 'react-day-picker/locale'
import type { Language } from '@/i18n/config'

/** The calendar's own locale for each language: month names, week start, day initials. */
export const CALENDAR_LOCALE: Record<Language, Locale> = { fr, en: enUS }
