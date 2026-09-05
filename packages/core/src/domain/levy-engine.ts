import type { Abatement, Brackets, Credit, Due, Elective, SkipPeriods } from './levy.ts'
import { addPeriod, endOfMonth } from './period.ts'
import type { ActivityInput, BaseScale, LevyPeriod, ModifierEffect, PeriodRef } from './types.ts'

/**
 * The arithmetic of a levy, on numbers alone: no database, no regime, no rate
 * of its own. Everything here takes what a rule row says (its parameters) and
 * what the measures layer read (amounts over a period) and returns a figure.
 * The service layer (services/activityStatement.ts) reads and assembles; this
 * file only computes, so every form can be proven on fixtures.
 *
 * Dates are calendar days as 'YYYY-MM-DD' strings, compared as strings.
 * Amounts are plain numbers; rounding to the cent is the caller's job, done
 * once at the edge.
 */

// ---------------------------------------------------------------------------
// Fiscal calendar
// ---------------------------------------------------------------------------

/** The day a fiscal year opens: 1 January nearly everywhere, 6 April in the UK. */
export interface FiscalCalendar {
  startMonth: number
  startDay: number
}

export interface DateRange {
  from: string
  to: string
}

/**
 * One period of a levy inside a fiscal year. The year is named by the calendar
 * year it opens in (the UK year opening on 6 April 2026 is 2026). `index` is
 * 1-based within the year: the first quarter is 1, the fourth 4.
 */
export interface FiscalPeriod extends DateRange {
  fiscalYear: number
  unit: LevyPeriod
  index: number
}

const MONTHS_PER: Record<LevyPeriod, number> = { month: 1, quarter: 3, half: 6, year: 12 }

export function periodsPerYear(unit: LevyPeriod): number {
  return 12 / MONTHS_PER[unit]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number]
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function addMonths(date: string, months: number): string {
  return addPeriod(date, 'month', months)
}

/** The first day of a fiscal year, clamped to the month when the day does not exist. */
export function fiscalYearStart(fiscalYear: number, cal: FiscalCalendar): string {
  const first = `${fiscalYear}-${pad(cal.startMonth)}-01`
  const last = endOfMonth(first)
  const day = Math.min(cal.startDay, Number(last.slice(8)))
  return `${fiscalYear}-${pad(cal.startMonth)}-${pad(day)}`
}

export function fiscalYearRange(fiscalYear: number, cal: FiscalCalendar): DateRange {
  return { from: fiscalYearStart(fiscalYear, cal), to: addDays(fiscalYearStart(fiscalYear + 1, cal), -1) }
}

/** The fiscal year a date belongs to. */
export function fiscalYearOf(date: string, cal: FiscalCalendar): number {
  const year = Number(date.slice(0, 4))
  return date < fiscalYearStart(year, cal) ? year - 1 : year
}

/** Every period of one unit in a fiscal year, in order. */
export function periodsOf(fiscalYear: number, cal: FiscalCalendar, unit: LevyPeriod): FiscalPeriod[] {
  const start = fiscalYearStart(fiscalYear, cal)
  const span = MONTHS_PER[unit]
  const periods: FiscalPeriod[] = []
  for (let i = 0; i < periodsPerYear(unit); i++) {
    periods.push({
      fiscalYear,
      unit,
      index: i + 1,
      from: addMonths(start, i * span),
      to: addDays(addMonths(start, (i + 1) * span), -1),
    })
  }
  return periods
}

export function periodContaining(date: string, cal: FiscalCalendar, unit: LevyPeriod): FiscalPeriod {
  const year = fiscalYearOf(date, cal)
  const found = periodsOf(year, cal, unit).find((p) => p.from <= date && date <= p.to)
  if (!found) throw new Error(`No ${unit} period contains ${date}`)
  return found
}

export function nextPeriod(period: FiscalPeriod, cal: FiscalCalendar): FiscalPeriod {
  const n = periodsPerYear(period.unit)
  return period.index < n
    ? periodsOf(period.fiscalYear, cal, period.unit)[period.index]!
    : periodsOf(period.fiscalYear + 1, cal, period.unit)[0]!
}

/** Twelve months ending on the last day of the period. */
export function rollingTwelveMonths(to: string): DateRange {
  return { from: addDays(addMonths(to, -12), 1), to }
}

/**
 * The window a measure is read over, for a rule whose own period is given:
 * the period itself, the fiscal year so far, the whole fiscal year, one of the
 * two years before it, or the twelve months ending with it.
 *
 * `ytd` and `year` open on the same day and differ by where they stop: `ytd`
 * grows period after period, so the row a table names moves through the year,
 * while `year` is one and the same window for every period the year holds,
 * which is what a monthly rule assessed on a yearly figure reads.
 */
export function resolvePeriodRef(ref: PeriodRef, period: FiscalPeriod, cal: FiscalCalendar): DateRange {
  switch (ref) {
    case 'current':
      return { from: period.from, to: period.to }
    case 'ytd':
      return { from: fiscalYearStart(period.fiscalYear, cal), to: period.to }
    case 'year':
      return fiscalYearRange(period.fiscalYear, cal)
    case 'year-1':
      return fiscalYearRange(period.fiscalYear - 1, cal)
    case 'year-2':
      return fiscalYearRange(period.fiscalYear - 2, cal)
    case 'rolling-12':
      return rollingTwelveMonths(period.to)
  }
}

export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to
}

/**
 * The months of a window during which the activity was open, counted in fiscal
 * months (a month of a year opening on the 6th runs from the 6th to the 5th).
 * A month touched by a single open day counts: a registration is monthly, and
 * a yearly figure spread "per month" is spread over the months registered.
 */
export function monthsOpen(
  range: DateRange,
  cal: FiscalCalendar,
  startedOn: string | null,
  closedOn: string | null,
): number {
  const from = startedOn && startedOn > range.from ? startedOn : range.from
  const to = closedOn && closedOn < range.to ? closedOn : range.to
  if (from > to) return 0
  let count = 0
  for (let year = fiscalYearOf(from, cal); year <= fiscalYearOf(to, cal); year++) {
    for (const month of periodsOf(year, cal, 'month')) if (overlaps(month, { from, to })) count++
  }
  return count
}

/** Months of the window already elapsed at a date, in fiscal months, capped at the window. */
export function monthsElapsed(range: DateRange, cal: FiscalCalendar, at: string): number {
  if (at < range.from) return 0
  return monthsOpen({ from: range.from, to: at < range.to ? at : range.to }, cal, null, null)
}

// ---------------------------------------------------------------------------
// Dated inputs
// ---------------------------------------------------------------------------

/** The value of a stated figure in force at a date: the latest one on or before it. */
export function inputAt(
  inputs: Pick<ActivityInput, 'name' | 'validFrom' | 'value'>[],
  name: string,
  date: string,
): number | null {
  let best: Pick<ActivityInput, 'name' | 'validFrom' | 'value'> | undefined
  for (const input of inputs) {
    if (input.name !== name || input.validFrom > date) continue
    if (!best || input.validFrom > best.validFrom) best = input
  }
  return best ? Number(best.value) : null
}

// ---------------------------------------------------------------------------
// Bracket tables
// ---------------------------------------------------------------------------

interface BoundedRow {
  upTo: number | null
}

/**
 * The row a value falls in: the first whose bound it does not exceed, the
 * open last row otherwise. A table is read ascending; a value exactly on a
 * bound belongs to the row that bound closes ("up to 35 000" includes 35 000).
 */
export function rowFor<Row extends BoundedRow>(rows: Row[], value: number): Row {
  for (const row of rows) if (row.upTo === null || value <= row.upTo) return row
  return rows[rows.length - 1]!
}

/** Each slice of the base taxed at its own rate, the way an income tax schedule works. */
export function progressiveAmount(rows: Brackets['rows'], base: number): number {
  let amount = 0
  let lower = 0
  for (const row of rows) {
    if (base <= lower) break
    const upper = row.upTo === null ? base : Math.min(base, row.upTo)
    amount += (upper - lower) * ((row.rate ?? 0) / 100)
    lower = upper
    if (row.upTo === null) break
  }
  return amount
}

/** The whole base taxed by the row it falls in: a rate on all of it, or a flat amount. */
export function stepAmount(rows: Brackets['rows'], base: number): number {
  const row = rowFor(rows, base)
  return row.amount !== undefined ? row.amount : base * ((row.rate ?? 0) / 100)
}

export function bracketsAmount(brackets: Brackets, base: number): number {
  return brackets.mode === 'progressive'
    ? progressiveAmount(brackets.rows, base)
    : stepAmount(brackets.rows, base)
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface BaseInput {
  /** The measure over the rule's period reference, already read. */
  measure: number
  /** `base_coefficient`: the share of the measure that counts (0.93, 0.67). */
  coefficient?: number | null
  /** Settlements of other rules the measure deducted and this base re-integrates. */
  addBack?: number
  abatement?: Abatement | null
  /** For a bracket abatement: the measure its table is read on (last year's profit). */
  abatementReference?: number | null
  /** Modifiers of effect `coefficient` in force: a start-of-activity reduction on the yield. */
  coefficientModifiers?: number[]
  floor?: number | null
  cap?: number | null
  scale?: BaseScale
  /** Months the activity was open over the reference window; required by a scale. */
  monthsOpen?: number
  /** How many of the rule's own periods a fiscal year holds; required by `per_period`. */
  periodsPerYear?: number
}

export interface BaseResolution {
  base: number
  /** What the abatement took off, for the screen to say so. */
  abatement: number
  /** The abatement rate applied, when one was. */
  abatementRate: number | null
}

/**
 * The abatement as an amount, given the value it applies to: a fixed share
 * (with its own floor when the regime gives one), or the share named by the
 * row a reference measure falls in.
 */
export function abatementOf(
  abatement: Abatement,
  value: number,
  reference: number | null,
): { amount: number; rate: number } {
  if ('rate' in abatement) {
    const computed = value * (abatement.rate / 100)
    return { amount: Math.max(computed, abatement.minAmount ?? 0), rate: abatement.rate }
  }
  const row = rowFor(abatement.brackets, reference ?? 0)
  return { amount: value * (row.rate / 100), rate: row.rate }
}

/**
 * From measure to base, the steps in a fixed order.
 *
 * The add-back comes before the coefficient: what a rule re-integrates is a
 * settlement the measure had deducted, so re-integrating it restores the gross
 * the coefficient then reduces (a contribution computed on the yield plus the
 * contributions themselves, less a generic deduction). Then the abatement, on
 * that value; then the coefficient modifiers, which the regimes studied apply
 * to the yield once abated; then the floor and cap; then the scale, which turns
 * a yearly reading into a monthly one, into the rule's own share of the year,
 * or a partial year into a whole one.
 *
 * An abatement or a coefficient never turns a positive base negative, and a
 * negative measure stays as it is: a loss is a fact the rule may floor.
 */
export function resolveBase(input: BaseInput): BaseResolution {
  let value = input.measure + (input.addBack ?? 0)
  if (input.coefficient !== null && input.coefficient !== undefined) value *= input.coefficient
  let abatement = 0
  let abatementRate: number | null = null
  if (input.abatement && value > 0) {
    const taken = abatementOf(input.abatement, value, input.abatementReference ?? null)
    abatement = Math.min(taken.amount, value)
    abatementRate = taken.rate
    value -= abatement
  }
  for (const factor of input.coefficientModifiers ?? []) if (value > 0) value *= factor
  if (input.floor !== null && input.floor !== undefined) value = Math.max(value, input.floor)
  if (input.cap !== null && input.cap !== undefined) value = Math.min(value, input.cap)
  const scale = input.scale ?? 'none'
  // `per_period` divides by a count the calendar fixes, not by what the
  // activity lived: a quarterly instalment on a yearly measure takes a
  // quarter of it whether or not the activity was open all year, because
  // that is the share the text asks for.
  if (scale === 'per_period') value /= input.periodsPerYear ?? 1
  else if (scale !== 'none') {
    const months = input.monthsOpen ?? 0
    if (months <= 0) value = 0
    else if (scale === 'per_month') value /= months
    else value *= 12 / months
  }
  return { base: value, abatement, abatementRate }
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

export type AmountInput =
  | { form: 'rate'; rate: number }
  | { form: 'brackets'; brackets: Brackets }
  | {
      form: 'elective_base'
      elective: Elective
      /** The base the user chose (a dated input), null when none was stated. */
      chosenBase: number | null
      /** The rule settles its year later, so the choice stands unbounded (see `electiveResolution`). */
      settledLater?: boolean
    }
  | { form: 'fixed'; amount: number }
  | { form: 'none' }

export interface ElectiveResolution {
  row: Elective['rows'][number]
  /** The base the amount was computed on, or the row's minimum when none was chosen. */
  appliedBase: number
  /** The base was not stated, so the minimum stood in. */
  assumed: boolean
}

/**
 * A base chosen against the row the reference falls in, taxed at the rate.
 * With no stated choice the row's minimum stands in, which is the least one
 * may declare, and the result says so.
 *
 * Whether the choice is bounded by that row depends on what the rule does at
 * year end, and the two readings must not be added up. A rule that settles its
 * year later (`settledLater`) provisions what is really paid every month,
 * which is the base as declared: the row the reference names moves period
 * after period while the year fills in, and bounding by it would already carry
 * the definitive bounds by the last period, so the settlement would then bill
 * the same gap a second time. There, the bounds belong to the regularisation
 * alone, which reads them once on the closed year. A rule that never settles
 * has no second reading, so the row bounds the choice here, and that is its
 * only protection against a figure the regime would not accept.
 */
export function electiveResolution(
  elective: Elective,
  reference: number,
  chosenBase: number | null,
  settledLater = false,
): ElectiveResolution {
  const row = rowFor(elective.rows, reference)
  if (chosenBase === null) return { row, appliedBase: row.minBase, assumed: true }
  if (settledLater) return { row, appliedBase: chosenBase, assumed: false }
  return { row, appliedBase: Math.min(Math.max(chosenBase, row.minBase), row.maxBase), assumed: false }
}

export interface AmountResolution {
  /** Before any credit. */
  gross: number
  elective?: ElectiveResolution
}

export function computeAmount(amount: AmountInput, base: number): AmountResolution {
  switch (amount.form) {
    case 'rate':
      return { gross: base * (amount.rate / 100) }
    case 'brackets':
      return { gross: bracketsAmount(amount.brackets, base) }
    case 'elective_base': {
      const elective = electiveResolution(
        amount.elective,
        base,
        amount.chosenBase,
        amount.settledLater ?? false,
      )
      return { gross: elective.appliedBase * (amount.elective.rate / 100), elective }
    }
    case 'fixed':
      return { gross: amount.amount }
    case 'none':
      return { gross: 0 }
  }
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export interface CreditValue {
  source: Credit['source']
  /** The measure read (withholdings, settlements or amount of another rule) over the credit's window. */
  value: number
  /** Percentage of it credited. */
  share: number
}

/**
 * What comes off the computed amount, after it: a share of what clients
 * withheld, instalments already paid, another rule's amount, then the fixed
 * credit and the stated personal credits. Credits reduce the amount and never
 * the base: a quarterly instalment is a rate on the profit less the quarter's
 * withholdings, an annual tax is a schedule less the instalments, and a credit
 * taken off the base would tax the difference instead.
 */
export function applyCredits(
  gross: number,
  credits: CreditValue[],
  fixedCredit: number | null | undefined,
  inputCredit: number | null | undefined,
): { credits: number; net: number } {
  let total = 0
  for (const credit of credits) total += credit.value * (credit.share / 100)
  total += fixedCredit ?? 0
  total += inputCredit ?? 0
  return { credits: total, net: gross - total }
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export interface ModifierSpec {
  effect: ModifierEffect
  value: number | null
  startsOn: string | null
  durationMonths: number | null
  durationPeriods: number | null
  endsOn: string | null
}

/**
 * The days a modifier is in force. It starts on its own date or on the day the
 * activity started; it ends after a number of months from that day, at the end
 * of the last of a number of the rule's own periods (the period the start falls
 * in counts as the first), on a named day, or never. Null when nothing fixes
 * the start.
 */
export function modifierRange(
  modifier: ModifierSpec,
  activityStartedOn: string | null,
  unit: LevyPeriod,
  cal: FiscalCalendar,
): { from: string; to: string | null } | null {
  const from = modifier.startsOn ?? activityStartedOn
  if (!from) return null
  if (modifier.durationMonths !== null)
    return { from, to: addDays(addMonths(from, modifier.durationMonths), -1) }
  if (modifier.durationPeriods !== null) {
    let period = periodContaining(from, cal, unit)
    for (let i = 1; i < modifier.durationPeriods; i++) period = nextPeriod(period, cal)
    return { from, to: period.to }
  }
  return { from, to: modifier.endsOn }
}

/**
 * The modifiers a period is computed with: those in force on its last day. A
 * period cannot be split, so the day it closes decides, which lets a
 * modifier starting mid-period apply to the whole of it and one ending
 * mid-period not.
 */
export function modifiersFor<M extends ModifierSpec>(
  modifiers: M[],
  period: FiscalPeriod,
  activityStartedOn: string | null,
  cal: FiscalCalendar,
): M[] {
  return modifiers.filter((m) => {
    const range = modifierRange(m, activityStartedOn, period.unit, cal)
    return range !== null && range.from <= period.to && (range.to === null || period.to <= range.to)
  })
}

export interface ModifierEffects {
  /** Product of the `coefficient` modifiers, applied to the base after its abatement. */
  coefficients: number[]
  /** Product of the `rate_factor` modifiers, applied to the computed amount. */
  rateFactor: number
  /** A `replace_amount` modifier: this amount stands in for the computed one. */
  replaceAmount: number | null
  exempt: boolean
}

export function effectsOf(modifiers: ModifierSpec[]): ModifierEffects {
  const effects: ModifierEffects = { coefficients: [], rateFactor: 1, replaceAmount: null, exempt: false }
  for (const m of modifiers) {
    switch (m.effect) {
      case 'coefficient':
        effects.coefficients.push(m.value ?? 1)
        break
      case 'rate_factor':
        effects.rateFactor *= m.value ?? 1
        break
      case 'replace_amount':
        effects.replaceAmount = m.value ?? 0
        break
      case 'exempt':
        effects.exempt = true
        break
    }
  }
  return effects
}

// ---------------------------------------------------------------------------
// One rule, one period
// ---------------------------------------------------------------------------

export interface LevyComputation {
  base: BaseInput
  amount: AmountInput
  modifiers?: ModifierEffects
  credits?: CreditValue[]
  fixedCredit?: number | null
  inputCredit?: number | null
}

export interface LevyResult {
  base: BaseResolution
  /** Before credits, after modifiers. */
  gross: number
  credits: number
  /** `gross − credits`, signed: below zero it is what the rule gives back. */
  net: number
  elective?: ElectiveResolution
  exempt: boolean
  replaced: boolean
}

/**
 * The whole pipeline for one period: base, then amount with its modifiers,
 * then credits. An exemption zeroes the amount and keeps nothing else; a
 * replacement stands in for the computed amount and still takes the credits.
 */
export function evaluateLevy(computation: LevyComputation): LevyResult {
  const effects = computation.modifiers ?? effectsOf([])
  const base = resolveBase({ ...computation.base, coefficientModifiers: effects.coefficients })
  if (effects.exempt) return { base, gross: 0, credits: 0, net: 0, exempt: true, replaced: false }
  const computed = computeAmount(computation.amount, base.base)
  const replaced = effects.replaceAmount !== null
  const gross = replaced ? effects.replaceAmount! : computed.gross * effects.rateFactor
  const { credits, net } = applyCredits(
    gross,
    computation.credits ?? [],
    computation.fixedCredit,
    computation.inputCredit,
  )
  return { base, gross, credits, net, elective: computed.elective, exempt: false, replaced }
}

// ---------------------------------------------------------------------------
// Regularisation
// ---------------------------------------------------------------------------

/**
 * `annual_deadzone`, for one month: the definitive reference of the closed
 * year names a row; nothing is owed while the chosen base sits within its
 * bounds; below the minimum the difference to it is owed, above the maximum
 * the difference to it is refunded (negative).
 *
 * This is the whole of the gap, not a top-up: the month it settles provisioned
 * the chosen base as declared, unbounded (see `electiveResolution`).
 */
export function deadzoneAdjustment(
  elective: Elective,
  definitiveReference: number,
  chosenBase: number,
): { row: Elective['rows'][number]; amount: number } {
  const row = rowFor(elective.rows, definitiveReference)
  if (chosenBase < row.minBase) return { row, amount: (row.minBase - chosenBase) * (elective.rate / 100) }
  if (chosenBase > row.maxBase) return { row, amount: (row.maxBase - chosenBase) * (elective.rate / 100) }
  return { row, amount: 0 }
}

/** `provisional_then_settled`: what the year should have cost, less what its periods provisioned. */
export function settlementDifference(definitive: number, provisional: number): number {
  return definitive - provisional
}

/** The month a regularisation falls due: a number of months after the year closed. */
export function regularizationWindow(fiscalYearEnd: string, monthOffset: number): DateRange {
  const day = addMonths(fiscalYearEnd, monthOffset)
  return { from: `${day.slice(0, 7)}-01`, to: endOfMonth(day) }
}

// ---------------------------------------------------------------------------
// Due windows
// ---------------------------------------------------------------------------

export interface DueWindow {
  /** When the return is filed. */
  declaration: DateRange
  /** When the money leaves: the declaration window, shifted when the rule says payment lags. */
  payment: DateRange
  /** Whether this period files no return of its own and rides in another one. */
  absorbed: boolean
  /** Of several dates a year, which one this is (1-based); 1 when there is one. */
  instalment: number
  instalments: number
}

export interface DueOptions {
  declarationLagMonths?: number | null
  firstDueAfterDays?: number | null
  activityStartedOn?: string | null
  skipPeriods?: SkipPeriods | null
}

function shift(range: DateRange, months: number): DateRange {
  return { from: addMonths(range.from, months), to: addMonths(range.to, months) }
}

function monthWindow(anchor: string, fromDay: number, toDay: number): DateRange {
  const month = anchor.slice(0, 7)
  const last = Number(endOfMonth(anchor).slice(8))
  return { from: `${month}-${pad(Math.min(fromDay, last))}`, to: `${month}-${pad(Math.min(toDay, last))}` }
}

function fixedDate(fiscalYear: number, date: { month: number; day: number; yearOffset: number }): string {
  const year = fiscalYear + date.yearOffset
  const last = Number(endOfMonth(`${year}-${pad(date.month)}-01`).slice(8))
  return `${year}-${pad(date.month)}-${pad(Math.min(date.day, last))}`
}

/**
 * The declaration windows of one period, before any deferral. `after_period`
 * opens in the month(s) after the period ends; `end_of_next_month` is that
 * window running the whole next month; `fixed_dates` names deadlines of the
 * fiscal year, each window running from the first of its month to the day.
 *
 * With as many dates as periods, each period gets its own date, in order. A
 * yearly rule with several dates is paid in as many instalments. Otherwise
 * the dates are cycled through.
 */
function declarationWindows(period: FiscalPeriod, due: Due): DateRange[] {
  switch (due.type) {
    case 'after_period':
      return [monthWindow(addMonths(period.to, due.monthOffset), due.fromDay, due.toDay)]
    case 'end_of_next_month': {
      const next = addMonths(period.to, 1)
      return [{ from: `${next.slice(0, 7)}-01`, to: endOfMonth(next) }]
    }
    case 'fixed_dates': {
      const n = periodsPerYear(period.unit)
      const chosen =
        due.dates.length === n
          ? [due.dates[period.index - 1]!]
          : n === 1
            ? due.dates
            : [due.dates[(period.index - 1) % due.dates.length]!]
      return chosen.map((d) => {
        const deadline = fixedDate(period.fiscalYear, d)
        return { from: `${deadline.slice(0, 7)}-01`, to: deadline }
      })
    }
  }
}

export function isSkipped(period: FiscalPeriod, skip: SkipPeriods | null | undefined): boolean {
  if (!skip) return false
  const indexes = skip[period.unit as keyof SkipPeriods]
  return Array.isArray(indexes) && indexes.includes(period.index)
}

/**
 * When a period is due. A first return that may not be filed before a number
 * of days after the activity started is deferred: the period is filed with the
 * first later period whose own window closes after that day, so the opening
 * months of an activity land in one return. A payment lag shifts the money
 * without moving the return.
 */
export function dueWindows(
  period: FiscalPeriod,
  due: Due,
  cal: FiscalCalendar,
  opts: DueOptions = {},
): DueWindow[] {
  let windows = declarationWindows(period, due)
  if (opts.firstDueAfterDays && opts.activityStartedOn) {
    const earliest = addDays(opts.activityStartedOn, opts.firstDueAfterDays)
    let later = period
    while (windows[windows.length - 1]!.to < earliest) {
      later = nextPeriod(later, cal)
      windows = declarationWindows(later, due)
    }
  }
  const lag = opts.declarationLagMonths ?? 0
  const absorbed = isSkipped(period, opts.skipPeriods)
  return windows.map((declaration, i) => ({
    declaration,
    payment: lag ? shift(declaration, lag) : declaration,
    absorbed,
    instalment: i + 1,
    instalments: windows.length,
  }))
}

/** A window widened on both sides, to match a settlement made a little early or a little late. */
export function widened(range: DateRange, days: number): DateRange {
  return { from: addDays(range.from, -days), to: addDays(range.to, days) }
}

// ---------------------------------------------------------------------------
// Accrual
// ---------------------------------------------------------------------------

/**
 * What a yearly rule has accrued part-way through its year: the amount the
 * annualised figures give, taken pro rata of the months elapsed. The screen
 * says it is an estimate; this is the arithmetic behind it.
 */
export function proratedAnnual(annualAmount: number, monthsElapsedInYear: number): number {
  return (annualAmount * Math.min(Math.max(monthsElapsedInYear, 0), 12)) / 12
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
