import { getLocale } from 'next-intl/server'
import { type Format, formatFor } from '@/lib/format'

/** The formatters of the language this request speaks, in an async server component or an action. */
export async function getFormat(): Promise<Format> {
  return formatFor(await getLocale())
}
