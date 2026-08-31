import type { Reading } from '@abacus/core/domain'
import { readingPreference } from '@abacus/core/services/preferences'
import { cookies } from 'next/headers'

/**
 * The reading a screen counts in, resolved from the three places a choice can
 * have been made, most local first:
 *
 *   1. the URL, because a link frames the screen it points at, and reloading
 *      or going back must give the figures it was written for;
 *   2. the session cookie, written by the tabs: switching the reading once
 *      holds on every screen until the browser closes, which is the whole
 *      point (two screens disagreeing on August for an invisible reason are
 *      worse than one reading);
 *   3. the profile, the value settled once and never re-said.
 *
 * The session lives in a cookie rather than in every link because the reading
 * is not a framing of one screen: it says what the figures mean. Carrying it
 * per screen is exactly what made it fall back to cash on every navigation.
 *
 * Neither the tabs nor a link ever writes the profile: a glance in the other
 * reading would redefine what the person counts in without announcing it.
 */
export const READING_COOKIE = 'reading'

export function parseReading(value: string | undefined): Reading | undefined {
  return value === 'cash' || value === 'accrual' ? value : undefined
}

export async function currentReading(params: { reading?: string }, userId: string): Promise<Reading> {
  const chosen = parseReading(params.reading) ?? parseReading((await cookies()).get(READING_COOKIE)?.value)
  return chosen ?? (await readingPreference(userId))
}
