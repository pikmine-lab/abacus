import { addPeriod } from '@abacus/core/domain/period'
import type { CommitmentWithProgress } from '@/components/commitment-blocks'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import { daysBetween } from '@/lib/utils'

/*
 * Kept out of the rail's client module: a server page importing a value from
 * a 'use client' file receives a client reference, not the value, and every
 * comparison against it is false.
 */

/** How far ahead a rail reads, in days: a month, so every monthly line has its dot on it. */
export const RAIL_DAYS = 30

/** One occurrence the rail places, by its due date. */
export interface RailMark {
  dueOn: string
}

/**
 * What a line's rail places: the occurrences that reached their date and wait,
 * those that fall within the rail's window, and the first one past it when
 * nothing ahead falls inside. A financing reads its written plan, since an
 * uneven plan is not a period apart; an open-ended commitment steps from its
 * next due date by its own rhythm.
 */
export function railMarks(
  c: CommitmentWithProgress,
  schedule: ScheduleLine[] | undefined,
  now: string,
): RailMark[] {
  const within = (dueOn: string) => daysBetween(now, dueOn) <= RAIL_DAYS
  const withNext = (marks: RailMark[], next: RailMark | undefined) =>
    next && !marks.some((m) => m.dueOn > now) ? [...marks, next] : marks
  if (schedule) {
    const unpaid = schedule.filter((i) => !i.paid).map((i) => ({ dueOn: i.dueOn }))
    return withNext(
      unpaid.filter((m) => within(m.dueOn)),
      unpaid.find((m) => !within(m.dueOn)),
    )
  }
  const marks: RailMark[] = []
  let dueOn = c.nextDueOn
  // Bounded: a weekly line left unconfirmed for a year still draws one late dot.
  for (let i = 0; i < 60 && within(dueOn); i++) {
    marks.push({ dueOn })
    dueOn = addPeriod(dueOn, c.periodUnit, c.periodCount)
  }
  return withNext(marks, { dueOn })
}
