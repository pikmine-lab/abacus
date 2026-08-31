import { db } from '../db/client.ts'
import { getPreferences, upsertPreferences } from '../db/datasources/preferences.ts'
import type { Reading } from '../domain/types.ts'

/**
 * What a person settles once and never has to say again: today, which month
 * they count a movement in.
 *
 * The distinction this file holds is between a preference and a switch. The
 * preference is where every session starts, and it changes only when someone
 * goes and changes it. Switching the reading on a screen is punctual: it holds
 * for that session and writes nothing here, because a glance in the other
 * reading would otherwise redefine what the person counts in, which is not
 * what clicking a tab announced.
 *
 * Nothing is created at signup. An absent row reads as the defaults, so
 * someone who never expressed a preference is served exactly like someone who
 * chose the default on purpose.
 */

/** Where a session starts when nothing was ever settled: the bank's reading. */
export const DEFAULT_READING: Reading = 'cash'

export async function readingPreference(userId: string): Promise<Reading> {
  const row = await getPreferences(db(), userId)
  return row?.reading ?? DEFAULT_READING
}

export async function setReadingPreference(userId: string, reading: Reading): Promise<Reading> {
  const row = await upsertPreferences(db(), userId, { reading })
  return row.reading
}
