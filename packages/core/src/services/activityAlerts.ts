import { DomainError } from '../domain/errors.ts'
import { fiscalYearOf } from '../domain/levy-engine.ts'
import { today as todayOf } from '../domain/period.ts'
import type { LevyStatus, PeriodRef, ThresholdMeasure } from '../domain/types.ts'
import { activityStatement } from './activityStatement.ts'
import { listActivities } from './catalog.ts'

/**
 * What a business activity should be told about today, across every activity
 * at once: a threshold its regime hinges on, and a rule whose figure can no
 * longer be trusted.
 *
 * The engine alerts and never switches a regime on its own. Leaving a VAT
 * exemption is adding the VAT rule; changing regime is closing the activity
 * and opening the next one. Both are gestures, with consequences the user has
 * to state, so the most this can do is say where the activity stands and hand
 * back the sentence the user wrote for that case.
 *
 * A figure is never quieter than its source. A rule whose review day has
 * passed was computed against a text that may have been replaced on the first
 * of January, and an unconfirmed one was never fixed by a text at all: both
 * are worth saying wherever their figures are read.
 *
 * Each activity is read through its own statement, once: that is where the
 * thresholds are already measured against the year, and computing them a
 * second time here would be a second answer to the same question.
 */

/**
 * How close to a threshold is close enough to say so: the measure is within
 * this share of the threshold's own value of it, on the side that still
 * complies. At four fifths of a ceiling there is still a fifth of it left to
 * act in (register for VAT, push a receipt into the next year, close the
 * activity); at nine tenths the warning and the crossing arrive together.
 */
const NEAR_THRESHOLD_SHARE = 0.8

export type ActivityAlertKind =
  | 'threshold_crossed'
  | 'threshold_near'
  | 'rule_review_due'
  | 'rule_unconfirmed'
  | 'activity_unreadable'

interface AlertOf {
  activityId: string
  activityName: string
  /** The threshold's label or the rule's name: what the alert is about. */
  subject: string
  /** The text the value was read in, when one was given. */
  sourceUrl: string | null
}

export interface ThresholdAlert extends AlertOf {
  kind: 'threshold_crossed' | 'threshold_near'
  measure: ThresholdMeasure
  periodRef: PeriodRef
  /** `lte`: the measure must stay under the value. `gte`: over it. */
  comparison: 'lte' | 'gte'
  /** The measure as it stands over the reference the threshold names. */
  current: number
  value: number
  /**
   * What changes past it, in the user's own words. The code writes the frame
   * of the sentence and never its content: what a threshold costs is a fact of
   * a regime, so it is configuration, and a sentence written here would be a
   * regime in the code.
   */
  consequence: string
}

export interface RuleAlert extends AlertOf {
  kind: 'rule_review_due' | 'rule_unconfirmed'
  status: LevyStatus
  /** The day the rule was due to be checked again; null on an unconfirmed one. */
  reviewOn: string | null
  verifiedOn: string | null
}

/**
 * An activity whose statement will not compute, because a rule carries
 * parameters the engine cannot read. It becomes an alert rather than an
 * exception: this list is read on the overview, and one activity misconfigured
 * in a corner of the settings must not take down the page every other activity
 * is read on. The message names the rule, which is where the correction is.
 */
export interface UnreadableAlert extends AlertOf {
  kind: 'activity_unreadable'
  reason: string
}

export type ActivityAlert = ThresholdAlert | RuleAlert | UnreadableAlert

/**
 * Whether an alert is about a threshold, and so carries its figures. A guard
 * rather than a comparison on the spot: each side of the union answers to two
 * kinds, which is one too many for the compiler to tell them apart alone.
 */
export function isThresholdAlert(alert: ActivityAlert): alert is ThresholdAlert {
  return alert.kind === 'threshold_crossed' || alert.kind === 'threshold_near'
}

/** Whether an alert is about a rule's source, and so carries its dates. */
export function isRuleAlert(alert: ActivityAlert): alert is RuleAlert {
  return alert.kind === 'rule_review_due' || alert.kind === 'rule_unconfirmed'
}

/** Worst first: a crossed threshold changes the regime, a stale source only dates a figure. */
const RANK: Record<ActivityAlertKind, number> = {
  activity_unreadable: 0,
  threshold_crossed: 1,
  threshold_near: 2,
  rule_review_due: 3,
  rule_unconfirmed: 4,
}

/** Whether a measure still complying is close enough to its threshold to be worth saying. */
function isNear(comparison: 'lte' | 'gte', current: number, value: number): boolean {
  if (value <= 0) return false
  // A `gte` threshold is approached from above, so the same distance is
  // measured on the other side of the value.
  return comparison === 'lte'
    ? current >= value * NEAR_THRESHOLD_SHARE
    : current <= value * (2 - NEAR_THRESHOLD_SHARE)
}

export async function activityAlerts(userId: string, today: string = todayOf()): Promise<ActivityAlert[]> {
  const activities = (await listActivities(userId)).filter(
    (a) => a.kind === 'business' && (a.closedOn === null || a.closedOn >= today),
  )
  const alerts: ActivityAlert[] = []

  for (const activity of activities) {
    const cal = { startMonth: activity.fiscalYearStartMonth, startDay: activity.fiscalYearStartDay }
    const of = (subject: string, sourceUrl: string | null) => ({
      activityId: activity.id,
      activityName: activity.name,
      subject,
      sourceUrl,
    })

    let statement: Awaited<ReturnType<typeof activityStatement>>
    try {
      statement = await activityStatement(userId, activity.id, fiscalYearOf(today, cal), today)
    } catch (e) {
      // Only a rule the engine cannot read is turned into an alert; anything
      // else is a real failure and belongs to whoever called.
      if (!(e instanceof DomainError && e.code === 'levy_misconfigured')) throw e
      alerts.push({ ...of(activity.name, null), kind: 'activity_unreadable', reason: e.message })
      continue
    }

    for (const threshold of statement.thresholds) {
      const kind = threshold.breached
        ? 'threshold_crossed'
        : isNear(threshold.comparison, threshold.current, threshold.value)
          ? 'threshold_near'
          : null
      if (kind === null) continue
      alerts.push({
        ...of(threshold.label, threshold.sourceUrl),
        kind,
        measure: threshold.measure,
        periodRef: threshold.periodRef,
        comparison: threshold.comparison,
        current: threshold.current,
        value: threshold.value,
        consequence: threshold.consequence,
      })
    }

    for (const levy of statement.levies) {
      // One rule, one line. A rule that is both unconfirmed and overdue is
      // told as overdue: that is the one with a day on it, so it is the one
      // that says what to do.
      const kind = levy.reviewDue
        ? 'rule_review_due'
        : levy.status === 'unconfirmed'
          ? 'rule_unconfirmed'
          : null
      if (kind === null) continue
      alerts.push({
        ...of(levy.name, levy.sourceUrl),
        kind,
        status: levy.status,
        reviewOn: levy.reviewOn,
        verifiedOn: levy.verifiedOn,
      })
    }
  }

  return alerts.sort(
    (a, b) =>
      RANK[a.kind] - RANK[b.kind] ||
      a.activityName.localeCompare(b.activityName) ||
      a.subject.localeCompare(b.subject),
  )
}
