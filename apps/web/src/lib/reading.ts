import type { Reading } from '@abacus/core/domain'
import { readingPreference } from '@abacus/core/services/preferences'
import { cookies } from 'next/headers'

/**
 * The reading a screen counts in, resolved from the three places a choice can
 * have been made, most local first:
 *
 *   1. the URL, which always wins: it says what this screen counts in, so a
 *      link, a reload and the back button all give the figures they name;
 *   2. the cookie, which carries the choice from screen to screen while the
 *      person walks the app (two screens disagreeing on August for an
 *      invisible reason are worse than having only one reading). It lasts the
 *      visit and no longer: proxy.ts drops it on every page load and reopens
 *      it from the URL, so nothing invisible outlives a reload;
 *   3. the profile, the value settled once and never re-said.
 *
 * The choice travels in a cookie rather than in every link because the reading
 * is not a framing of one screen: it says what the figures mean, and a link
 * built without it would silently drop it, which is the very thing being
 * fixed. Only the preferences screen writes the profile: a glance in the other
 * reading would otherwise redefine what the person counts in without ever
 * announcing it.
 */
export const READING_COOKIE = 'reading'

export function parseReading(value: string | undefined): Reading | undefined {
  return value === 'cash' || value === 'accrual' ? value : undefined
}

export async function currentReading(params: { reading?: string }, userId: string): Promise<Reading> {
  const chosen = parseReading(params.reading) ?? parseReading((await cookies()).get(READING_COOKIE)?.value)
  return chosen ?? (await readingPreference(userId))
}
