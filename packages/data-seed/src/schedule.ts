import { addPeriod } from '@abacus/core/domain/period'
import type { PeriodUnit } from '@abacus/core/domain/types'
import { confirmNextOccurrence } from '@abacus/core/services/commitments'

type Overrides = NonNullable<Parameters<typeof confirmNextOccurrence>[2]>

/** The due dates of a schedule from its first one, up to a day included. */
export function dueDates(firstDueOn: string, unit: PeriodUnit, count: number, until: string): string[] {
  const dates: string[] = []
  for (let due = firstDueOn; due <= until; due = addPeriod(due, unit, count)) dates.push(due)
  return dates
}

/**
 * Confirms a commitment's occurrences one by one, oldest first, as a person
 * catching up on them would: each one through the service, so the movement,
 * the advance of the schedule and any price change land exactly as they would
 * from a screen.
 */
export async function confirmEach(
  userId: string,
  commitmentId: string,
  dues: string[],
  overrides: (dueOn: string, index: number) => Overrides = () => ({}),
): Promise<void> {
  for (const [index, dueOn] of dues.entries())
    await confirmNextOccurrence(userId, commitmentId, overrides(dueOn, index))
}
