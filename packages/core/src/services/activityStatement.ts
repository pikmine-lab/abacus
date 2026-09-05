import { db, type Executor } from '../db/client.ts'
import { getActivity, getCategory } from '../db/datasources/catalog.ts'
import {
  type ActivityScope,
  activityScope,
  type CategoryTotal,
  expensesByCategory,
  levySettlements,
  listActivityInputs,
  listLevies,
  listLeviesOverlapping,
  listLevyModifiers,
  listThresholds,
  type Measures,
  type NamedTotal,
  paidToSelf as paidToSelfDs,
  readMeasures,
  readRevenue,
  revenueByClient,
  type Settlement,
  treasury as treasuryDs,
  withholdingShare,
} from '../db/datasources/measures.ts'
import { DomainError } from '../domain/errors.ts'
import {
  abatementSchema,
  type Brackets,
  bracketsSchema,
  type Credit,
  creditsSchema,
  type Due,
  dueSchema,
  type Elective,
  electiveSchema,
  regularizationParamsSchema,
  skipPeriodsSchema,
} from '../domain/levy.ts'
import {
  type AmountInput,
  addDays,
  type CreditValue,
  type DateRange,
  type DueWindow,
  deadzoneAdjustment,
  dueWindows,
  effectsOf,
  evaluateLevy,
  type FiscalCalendar,
  type FiscalPeriod,
  fiscalYearRange,
  inputAt,
  type LevyResult,
  type ModifierSpec,
  modifiersFor,
  monthsOpen,
  periodsOf,
  regularizationWindow,
  resolvePeriodRef,
  round2,
  settlementDifference,
  widened,
} from '../domain/levy-engine.ts'
import { endOfMonth, today as todayOf } from '../domain/period.ts'
import type {
  Activity,
  ActivityInput,
  AmountForm,
  DeductibleExpenses,
  Levy,
  LevyKind,
  LevyModifier,
  LevyPeriod,
  LevyStatus,
  PeriodRef,
  RevenueBasis,
  ThresholdMeasure,
} from '../domain/types.ts'
import { pendingOccurrences } from './commitments.ts'
import { declareMovement } from './movements.ts'

/**
 * The statement of one fiscal year of a business activity: what came in, what
 * it owes, what is already paid, what is left to pay and by when, and what the
 * owner may take out of it today.
 *
 * Everything here is an estimate computed from the rules the user declared: it
 * is what the regime says of the facts recorded, never an official assessment.
 * A gap between a provision and its settlement is shown, never quietly
 * corrected.
 *
 * Three figures answer three different questions and must not be confused. A
 * provision is what a period owes; the reserve is what has accrued and not yet
 * been paid, so it is money to keep; what is payable to oneself is a stock
 * (the treasury less that reserve and the commitments of the month), while the
 * net is a flow.
 *
 * A payment against a rule is never a charge of its own: it settles the
 * provision. `deductible` says whether it also reduces the profit, and
 * `pass_through` (VAT collected for the state) leaves the net entirely while
 * staying in the reserve, because it is owed.
 */

// ---------------------------------------------------------------------------
// What the statement is made of
// ---------------------------------------------------------------------------

export interface StatementActivity {
  id: string
  name: string
  regimeLabel: string | null
  currency: string
  startedOn: string | null
  closedOn: string | null
  revenueBasis: RevenueBasis
  vatRegistered: boolean
  deductibleExpenses: DeductibleExpenses
  fiscalYear: number
  /** The fiscal year as days, which is rarely 1 January to 31 December. */
  period: DateRange
  /** Fiscal months of the year during which the activity was open. */
  monthsOpen: number
}

export interface StatementTotals {
  /** Revenue before VAT, in the regime's basis. */
  revenue: number
  /** The same year read on the other basis, the secondary reading a screen shows beside it. */
  revenueOtherBasis: { basis: RevenueBasis; revenue: number }
  revenueInclVat: number
  /** Deductible charges, settlements of rules excluded. */
  expenses: number
  /** Accrued provisions of the rules that are a charge (pass-through excluded). */
  provisions: number
  /** Accrued provisions of the pass-through rules: owed, but never a charge. */
  provisionsPassThrough: number
  /** `revenue − expenses − provisions`. */
  net: number
  paidToSelf: number
  vatCollected: number
  vatDeductible: number
  withholdings: number
}

export interface StatementMonth {
  /** First day of the month, so it sorts and formats like any other date. */
  month: string
  revenue: number
  provisions: number
  expenses: number
  net: number
  paidToSelf: number
  /** The month the statement was read in: its figures are partial. */
  running: boolean
}

/**
 * How a rule's accrual was reached. `closed_periods`: only periods that ended
 * count. `prorated`: the period in progress is estimated on its own figures
 * scaled to the whole period (which is what a bracket table has to be read
 * on), then taken pro rata of the part elapsed.
 */
export type AccrualMethod = 'closed_periods' | 'prorated'

export interface StatementLevy {
  id: string
  name: string
  kind: LevyKind
  status: LevyStatus
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
  /** The day to check the rule again has passed. */
  reviewDue: boolean
  period: LevyPeriod
  amountForm: AmountForm
  deductible: boolean
  passThrough: boolean
  settlementCategory: { id: string; name: string } | null
  /** The period being lived through and what it owes so far, when there is one. */
  currentPeriod: { from: string; to: string; index: number; amount: number } | null
  accrued: number
  accrualMethod: AccrualMethod
  /** Settlements of this rule dated in the year, up to the day read. */
  paid: number
  /** `accrued − paid`, never negative: money to keep. */
  reserve: number
  /** What was paid beyond what accrued, said apart rather than as a negative reserve. */
  overpaid: number
  /** The chosen contribution base was not stated, so the row's minimum stood in. */
  assumedElectiveBase: boolean
}

export type ScheduleStatus = 'paid' | 'upcoming' | 'overdue'

export interface ScheduleEntry {
  levyId: string
  levyName: string
  levyKind: LevyKind
  /** A period of the year, or the settlement of a closed year. */
  entry: 'period' | 'regularization'
  /** The year the entry is about, which for a regularisation is not the year it falls due in. */
  forFiscalYear: number
  /** The period it covers; a regularisation covers a whole year. */
  period: DateRange
  periodIndex: number
  /** When the return is filed. */
  declaration: DateRange
  /** When the money leaves. */
  payment: DateRange
  /** Estimated, signed: below zero it is what the rule gives back. */
  amount: number
  /** This period files no return of its own: it rides in another one. */
  absorbed: boolean
  instalment: number
  instalments: number
  status: ScheduleStatus
  /** The settlement that answered it, when one did. */
  paidOn: string | null
  paidAmount: number | null
}

export interface PayableToSelf {
  /** What the activity's accounts hold today. */
  treasury: number
  /** The sum of the reserves, VAT included: it is owed. */
  reserve: number
  /** Occurrences of the activity's commitments due between today and the end of the month. */
  commitments: number
  /** `treasury − reserve − commitments`, which may be negative. */
  amount: number
}

export interface StatementThreshold {
  id: string
  label: string
  measure: ThresholdMeasure
  periodRef: PeriodRef
  comparison: 'lte' | 'gte'
  value: number
  /** The measure as it stands, over the reference the threshold names. */
  current: number
  /** Where the current value sits against the threshold, as a share of it. */
  progress: number
  /** The threshold is crossed the wrong way. */
  breached: boolean
  consequence: string
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
}

export interface ActivityStatement {
  activity: StatementActivity
  /** The day the statement was read on: every "so far" is as of this day. */
  asOf: string
  /** The basis every figure is in, which is the regime's. */
  basis: RevenueBasis
  totals: StatementTotals
  months: StatementMonth[]
  levies: StatementLevy[]
  schedule: ScheduleEntry[]
  /** Σ of the reserves, the money the activity is keeping for what it owes. */
  reserve: number
  payableToSelf: PayableToSelf
  revenueByClient: NamedTotal[]
  expensesByCategory: CategoryTotal[]
  thresholds: StatementThreshold[]
}

// ---------------------------------------------------------------------------
// Reading the measures once
// ---------------------------------------------------------------------------

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}

/**
 * How much of a window has happened, as the factor that scales what it holds
 * up to what it will hold: a year read in May is a bit more than a third of a
 * year, and a bracket table read on a third of a year would name the wrong
 * row. A window already closed scales by one.
 */
function projection(range: DateRange, on: string): number {
  if (range.to <= on || range.from > on) return 1
  return daysBetween(range.from, range.to) / daysBetween(range.from, on)
}

/** Measures read once per window and basis: a year of rules asks for the same ones many times. */
class Ledger {
  private readonly cache = new Map<string, Promise<Measures>>()
  private readonly tx: Executor
  private readonly scope: ActivityScope

  constructor(tx: Executor, scope: ActivityScope) {
    this.tx = tx
    this.scope = scope
  }

  measures(range: DateRange, basis?: RevenueBasis): Promise<Measures> {
    const key = `${range.from}|${range.to}|${basis ?? this.scope.basis}`
    let pending = this.cache.get(key)
    if (!pending) {
      pending = readMeasures(this.tx, this.scope, range, basis)
      this.cache.set(key, pending)
    }
    return pending
  }
}

const MEASURE_OF: Record<string, (m: Measures) => number> = {
  revenue: (m) => m.revenue,
  revenue_incl_vat: (m) => m.revenueInclVat,
  expenses: (m) => m.expenses,
  profit: (m) => m.profit,
  vat_balance: (m) => m.vatBalance,
  withholdings: (m) => m.withholdings,
}

// ---------------------------------------------------------------------------
// One rule, parsed once
// ---------------------------------------------------------------------------

/** The JSON parameters of a rule, parsed by the schemas that own their shape. */
interface ParsedLevy {
  row: Levy
  due: Due
  brackets: Brackets | null
  elective: Elective | null
  abatement: ReturnType<typeof abatementSchema.parse> | null
  credits: Credit[]
  skipPeriods: ReturnType<typeof skipPeriodsSchema.parse> | null
  regularizationParams: ReturnType<typeof regularizationParamsSchema.parse> | null
  modifiers: RuleModifier[]
}

/** A modifier as the engine reads it: its value is a number there, a numeric string in the row. */
interface RuleModifier extends ModifierSpec {
  label: string
  status: LevyStatus
}

function ruleModifier(row: LevyModifier): RuleModifier {
  return {
    label: row.label,
    status: row.status,
    effect: row.effect,
    value: row.value === null ? null : Number(row.value),
    startsOn: row.startsOn,
    durationMonths: row.durationMonths,
    durationPeriods: row.durationPeriods,
    endsOn: row.endsOn,
  }
}

function parseLevy(row: Levy, modifiers: LevyModifier[]): ParsedLevy {
  try {
    return {
      row,
      due: dueSchema.parse(row.due),
      brackets: row.brackets ? bracketsSchema.parse(row.brackets) : null,
      elective: row.elective ? electiveSchema.parse(row.elective) : null,
      abatement: row.baseAbatement ? abatementSchema.parse(row.baseAbatement) : null,
      credits: row.baseCredits ? creditsSchema.parse(row.baseCredits) : [],
      skipPeriods: row.skipPeriods ? skipPeriodsSchema.parse(row.skipPeriods) : null,
      regularizationParams: row.regularizationParams
        ? regularizationParamsSchema.parse(row.regularizationParams)
        : null,
      modifiers: modifiers.map(ruleModifier),
    }
  } catch (e) {
    throw new DomainError(
      'levy_misconfigured',
      `Rule "${row.name}" carries parameters the engine cannot read: ${(e as Error).message}`,
    )
  }
}

/** What one period of one rule came to, and everything the screen says about it. */
interface PeriodResult {
  period: FiscalPeriod
  result: LevyResult
  /** Signed amount owed for the period, after credits and after the pro rata of a running period. */
  amount: number
  /** The share of the period already lived through, 1 for a closed one. */
  elapsed: number
}

// ---------------------------------------------------------------------------
// The engine driver
// ---------------------------------------------------------------------------

class StatementEngine {
  private readonly byId: Map<string, ParsedLevy>
  private readonly settlementsByLevy = new Map<string, Settlement[]>()
  private readonly ledger: Ledger
  private readonly inputs: ActivityInput[]
  private readonly cal: FiscalCalendar
  private readonly activity: Activity
  private readonly on: string

  constructor(
    ledger: Ledger,
    levies: ParsedLevy[],
    inputs: ActivityInput[],
    cal: FiscalCalendar,
    activity: Activity,
    on: string,
    settlements: Settlement[],
  ) {
    this.ledger = ledger
    this.inputs = inputs
    this.cal = cal
    this.activity = activity
    this.on = on
    this.byId = new Map(levies.map((l) => [l.row.id, l]))
    for (const levy of levies) {
      if (!levy.row.settlementCategoryId) continue
      this.settlementsByLevy.set(
        levy.row.id,
        settlements.filter((s) => s.categoryId === levy.row.settlementCategoryId),
      )
    }
  }

  settlements(levyId: string, range?: DateRange): Settlement[] {
    const rows = this.settlementsByLevy.get(levyId) ?? []
    return range ? rows.filter((s) => s.happenedOn >= range.from && s.happenedOn <= range.to) : rows
  }

  private paidOver(levyId: string, range: DateRange): number {
    return this.settlements(levyId, range).reduce((sum, s) => sum + s.amount, 0)
  }

  input(name: string | null, on: string): number | null {
    return name ? inputAt(this.inputs, name, on) : null
  }

  /**
   * The periods of a fiscal year a rule governs: those its validity covers on
   * their closing day, and during which the activity was open. A rate replaced
   * on a date is a new row, so the day a period closes is what tells the two
   * rows apart, exactly as it tells which modifiers a period was computed
   * with.
   */
  governedPeriods(levy: ParsedLevy, fiscalYear: number): FiscalPeriod[] {
    const { validFrom, validTo } = levy.row
    return periodsOf(fiscalYear, this.cal, levy.row.period).filter((p) => {
      if (validFrom > p.to) return false
      if (validTo && validTo < p.to) return false
      if (this.activity.startedOn && this.activity.startedOn > p.to) return false
      if (this.activity.closedOn && this.activity.closedOn < p.from) return false
      return true
    })
  }

  /** A measure over a window, scaled up to the whole window when it is still running. */
  private async measure(
    measure: string,
    range: DateRange,
    scale: number,
    levyId: string | null,
    inputName: string | null,
    seen: Set<string>,
  ): Promise<number> {
    switch (measure) {
      case 'none':
        return 0
      case 'input':
        return this.input(inputName, range.to) ?? 0
      case 'paid':
        return levyId ? this.paidOver(levyId, range) * scale : 0
      case 'amount':
        return levyId ? await this.amountOf(levyId, range, seen) : 0
      default: {
        const measures = await this.ledger.measures(range)
        const read = MEASURE_OF[measure]
        return read ? read(measures) * scale : 0
      }
    }
  }

  /**
   * What another rule computes over a window: an instalment assessed on last
   * year's tax, a surcharge sitting on a tax. Every period of that rule
   * closing inside the window is evaluated and summed.
   */
  private async amountOf(levyId: string, range: DateRange, seen: Set<string>): Promise<number> {
    if (seen.has(levyId))
      throw new DomainError('levy_cycle', 'These rules read each other in a circle: one of them must not.')
    const levy = this.byId.get(levyId)
    if (!levy) return 0
    const chain = new Set(seen).add(levyId)
    let total = 0
    for (let year = Number(range.from.slice(0, 4)) - 1; year <= Number(range.to.slice(0, 4)) + 1; year++) {
      for (const period of this.governedPeriods(levy, year)) {
        if (period.to < range.from || period.to > range.to) continue
        total += (await this.evaluate(levy, period, chain)).amount
      }
    }
    return total
  }

  private amountInput(levy: ParsedLevy, period: FiscalPeriod): AmountInput {
    const row = levy.row
    switch (row.amountForm) {
      case 'rate':
        return { form: 'rate', rate: Number(row.rate ?? 0) }
      case 'brackets':
        return { form: 'brackets', brackets: levy.brackets! }
      case 'elective_base':
        return {
          form: 'elective_base',
          elective: levy.elective!,
          chosenBase: this.input(levy.elective!.inputName, period.to),
        }
      case 'fixed':
        return {
          form: 'fixed',
          amount:
            row.fixedAmount !== null
              ? Number(row.fixedAmount)
              : (this.input(row.fixedInputName, period.to) ?? 0),
        }
      case 'none':
        return { form: 'none' }
    }
  }

  /** One rule over one of its periods, credits and modifiers included. */
  async evaluate(
    levy: ParsedLevy,
    period: FiscalPeriod,
    seen: Set<string> = new Set(),
  ): Promise<PeriodResult> {
    const row = levy.row
    const baseRange = resolvePeriodRef(row.basePeriodRef, period, this.cal)
    const baseScale = projection(baseRange, this.on)
    const measure = await this.measure(
      row.baseMeasure,
      baseRange,
      baseScale,
      row.baseLevyId,
      row.baseInputName,
      seen,
    )
    let addBack = 0
    for (const id of row.baseAddBackLevyIds ?? []) addBack += this.paidOver(id, baseRange) * baseScale
    let abatementReference: number | null = null
    if (levy.abatement && 'brackets' in levy.abatement) {
      const on = levy.abatement.on
      const window = resolvePeriodRef(on.periodRef, period, this.cal)
      abatementReference = await this.measure(
        on.measure,
        window,
        projection(window, this.on),
        null,
        null,
        seen,
      )
    }
    const credits: CreditValue[] = []
    for (const credit of levy.credits) {
      const window = resolvePeriodRef(credit.periodRef, period, this.cal)
      const scale = projection(window, this.on)
      credits.push({
        source: credit.source,
        share: credit.share,
        value: await this.measure(
          credit.source === 'withholdings' ? 'withholdings' : credit.source,
          window,
          scale,
          credit.levyId ?? null,
          null,
          seen,
        ),
      })
    }
    const result = evaluateLevy({
      base: {
        measure,
        addBack,
        coefficient: row.baseCoefficient === null ? null : Number(row.baseCoefficient),
        abatement: levy.abatement,
        abatementReference,
        floor: row.baseFloor === null ? null : Number(row.baseFloor),
        cap: row.baseCap === null ? null : Number(row.baseCap),
        scale: row.baseScale,
        monthsOpen: monthsOpen(baseRange, this.cal, this.activity.startedOn, this.activity.closedOn),
      },
      amount: this.amountInput(levy, period),
      modifiers: effectsOf(modifiersFor(levy.modifiers, period, this.activity.startedOn, this.cal)),
      credits,
      fixedCredit: row.fixedCredit === null ? null : Number(row.fixedCredit),
      inputCredit: this.input(row.creditInputName, period.to),
    })
    // A period still running owes what it has lived through: the figures were
    // read scaled to the whole period just above (a schedule has to be read on
    // a whole year), so the amount comes back down here.
    const elapsed = period.to <= this.on ? 1 : period.from > this.on ? 0 : 1 / projection(period, this.on)
    return { period, result, amount: result.net * elapsed, elapsed }
  }

  /**
   * What a rule with a regularisation owes for a closed year, beyond what its
   * periods provisioned. A dead zone compares the base chosen every month with
   * the row the definitive figures name, and owes nothing while it sits inside
   * it; a provisional rule owes the difference between the definitive amount
   * and what was provisioned.
   */
  async regularization(levy: ParsedLevy, fiscalYear: number): Promise<number | null> {
    const row = levy.row
    if (row.regularization === 'none') return null
    const periods = this.governedPeriods(levy, fiscalYear)
    if (periods.length === 0) return null
    const last = periods[periods.length - 1]!
    if (row.regularization === 'annual_deadzone') {
      if (!levy.elective) return null
      const definitive = await this.evaluate(levy, last)
      let total = 0
      for (const period of periods) {
        const chosen = this.input(levy.elective.inputName, period.to)
        if (chosen === null) continue
        total += deadzoneAdjustment(levy.elective, definitive.result.base.base, chosen).amount
      }
      return total
    }
    const definitive = await this.evaluate(levy, last)
    let provisional = 0
    for (const period of periods) provisional += (await this.evaluate(levy, period)).amount
    return settlementDifference(definitive.result.net, provisional)
  }
}

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

/** How wide a settlement may fall around its window and still answer it. */
const SETTLEMENT_TOLERANCE_DAYS = 15

function monthsOfYear(fiscalYear: number, cal: FiscalCalendar): FiscalPeriod[] {
  return periodsOf(fiscalYear, cal, 'month')
}

function scheduleStatus(window: DueWindow, on: string, settlement: Settlement | undefined): ScheduleStatus {
  if (settlement) return 'paid'
  return window.payment.to < on ? 'overdue' : 'upcoming'
}

/**
 * The statement of one fiscal year, as of a day (today unless a day is given,
 * which is what lets a closed year be read as it stood).
 */
export async function activityStatement(
  userId: string,
  activityId: string,
  fiscalYear: number,
  today: string = todayOf(),
): Promise<ActivityStatement> {
  const sql = db()
  const activity = await getActivity(sql, userId, activityId)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
  if (activity.kind !== 'business')
    throw new DomainError(
      'not_a_business_activity',
      `"${activity.name}" is an analysis dimension, not a business: it has no regime, and no statement.`,
    )

  const cal: FiscalCalendar = {
    startMonth: activity.fiscalYearStartMonth,
    startDay: activity.fiscalYearStartDay,
  }
  const year = fiscalYearRange(fiscalYear, cal)
  // Everything "so far" stops at the day read, and a closed year is whole.
  const asOf = today > year.to ? year.to : today
  const soFar: DateRange = { from: year.from, to: asOf < year.from ? year.from : asOf }

  const scope = await activityScope(sql, userId, activity)
  const [rows, inputs, thresholds] = await Promise.all([
    // Two years back: an instalment may be assessed on a year long closed, and
    // the settlement of the year before falls due inside this one.
    listLeviesOverlapping(sql, userId, activityId, {
      from: fiscalYearRange(fiscalYear - 2, cal).from,
      to: year.to,
    }),
    listActivityInputs(sql, userId, activityId),
    listThresholds(sql, userId, activityId),
  ])
  const modifiers = await listLevyModifiers(
    sql,
    rows.map((r) => r.id),
  )
  const levies = rows.map((row) =>
    parseLevy(
      row,
      modifiers.filter((m) => m.levyId === row.id),
    ),
  )
  const settlementCategories = [
    ...new Set(rows.map((r) => r.settlementCategoryId).filter((id): id is string => id !== null)),
  ]
  // Settlements are read over a wider window than the year: a period of this
  // year is paid in the next one, and the settlement that answers it has to be
  // found wherever it landed.
  const settlements = await levySettlements(sql, scope, settlementCategories, {
    from: addDays(fiscalYearRange(fiscalYear - 1, cal).from, -SETTLEMENT_TOLERANCE_DAYS),
    to: addDays(fiscalYearRange(fiscalYear + 2, cal).to, SETTLEMENT_TOLERANCE_DAYS),
  })

  const ledger = new Ledger(sql, scope)
  const engine = new StatementEngine(ledger, levies, inputs, cal, activity, asOf, settlements)

  // --- the year's own figures -------------------------------------------------
  const measures = await ledger.measures(soFar)
  const otherBasis: RevenueBasis = activity.revenueBasis === 'cash' ? 'invoiced' : 'cash'
  const [otherRevenue, paidToSelfYear, treasuryNow, clients, categories] = await Promise.all([
    readRevenue(sql, scope, soFar, otherBasis),
    paidToSelfDs(sql, scope, soFar),
    treasuryDs(sql, scope, today),
    revenueByClient(sql, scope, soFar),
    expensesByCategory(sql, scope, soFar),
  ])

  // --- rule by rule -----------------------------------------------------------
  const months = monthsOfYear(fiscalYear, cal)
  const provisionPerMonth = new Array(months.length).fill(0)
  const statementLevies: StatementLevy[] = []
  const schedule: ScheduleEntry[] = []
  const categoryNames = new Map<string, string>()
  // The settlements a due date has already been credited with.
  const claimed = new Set<string>()
  for (const id of settlementCategories) {
    const category = await getCategory(sql, userId, id)
    if (category) categoryNames.set(id, category.name)
  }

  for (const levy of levies) {
    const row = levy.row
    const periods = engine.governedPeriods(levy, fiscalYear)
    if (periods.length === 0 && row.validFrom > year.to) continue
    let accrued = 0
    let assumedElectiveBase = false
    let current: StatementLevy['currentPeriod'] = null

    for (const period of periods) {
      const evaluated = await engine.evaluate(levy, period)
      if (evaluated.result.elective?.assumed) assumedElectiveBase = true
      if (period.from <= asOf && asOf <= period.to && today <= year.to)
        current = { from: period.from, to: period.to, index: period.index, amount: round2(evaluated.amount) }
      accrued += evaluated.amount
      // Spread over the months of the period already begun, so the monthly
      // reading of a quarterly rule is not one spike every three months.
      const begun = months.filter((m) => m.from >= period.from && m.from <= period.to && m.from <= asOf)
      for (const month of begun) provisionPerMonth[month.index - 1]! += evaluated.amount / begun.length

      for (const window of dueWindows(period, levy.due, cal, {
        declarationLagMonths: row.declarationLagMonths,
        firstDueAfterDays: row.firstDueAfterDays,
        activityStartedOn: activity.startedOn,
        skipPeriods: levy.skipPeriods,
      })) {
        // One settlement answers one due date: what a window already claimed
        // cannot answer the next one, or a single payment would clear a year.
        const tolerant = widened(window.payment, SETTLEMENT_TOLERANCE_DAYS)
        const settlement = engine.settlements(row.id, tolerant).find((s) => !claimed.has(s.movementId))
        if (settlement) claimed.add(settlement.movementId)
        // A period whose figures are not in yet estimates nothing; the window
        // is still worth listing, because the return is owed either way.
        const share = window.instalments > 1 ? 1 / window.instalments : 1
        schedule.push({
          levyId: row.id,
          levyName: row.name,
          levyKind: row.kind,
          entry: 'period',
          forFiscalYear: fiscalYear,
          period: { from: period.from, to: period.to },
          periodIndex: period.index,
          declaration: window.declaration,
          payment: window.payment,
          amount: round2(evaluated.result.net * share),
          absorbed: window.absorbed,
          instalment: window.instalment,
          instalments: window.instalments,
          status: scheduleStatus(window, today, settlement),
          paidOn: settlement?.happenedOn ?? null,
          paidAmount: settlement ? settlement.amount : null,
        })
      }
    }
    // A rule whose periods are all closed accrues what they came to; one still
    // living through a period accrues that period pro rata (see AccrualMethod).
    const accrualMethod: AccrualMethod = current === null ? 'closed_periods' : 'prorated'
    const paid = engine.settlements(row.id, soFar).reduce((sum, s) => sum + s.amount, 0)
    statementLevies.push({
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      sourceUrl: row.sourceUrl,
      verifiedOn: row.verifiedOn,
      reviewOn: row.reviewOn,
      reviewDue: row.reviewOn !== null && row.reviewOn <= today,
      period: row.period,
      amountForm: row.amountForm,
      deductible: row.deductible,
      passThrough: row.passThrough,
      settlementCategory: row.settlementCategoryId
        ? { id: row.settlementCategoryId, name: categoryNames.get(row.settlementCategoryId) ?? '' }
        : null,
      currentPeriod: current,
      accrued: round2(accrued),
      accrualMethod,
      paid: round2(paid),
      reserve: round2(Math.max(0, accrued - paid)),
      overpaid: round2(Math.max(0, paid - accrued)),
      assumedElectiveBase,
    })

    // --- regularisations: an entry of the following year, signed -------------
    for (const settled of [fiscalYear - 1, fiscalYear]) {
      const amount = await engine.regularization(levy, settled)
      if (amount === null || round2(amount) === 0) continue
      const offset = levy.regularizationParams?.settleMonthOffset ?? 12
      const window = regularizationWindow(fiscalYearRange(settled, cal).to, offset)
      if (settled === fiscalYear - 1 && window.to > year.to) continue
      const tolerant = widened(window, SETTLEMENT_TOLERANCE_DAYS)
      const settlement = engine.settlements(row.id, tolerant).find((s) => !claimed.has(s.movementId))
      if (settlement) claimed.add(settlement.movementId)
      schedule.push({
        levyId: row.id,
        levyName: row.name,
        levyKind: row.kind,
        entry: 'regularization',
        forFiscalYear: settled,
        period: fiscalYearRange(settled, cal),
        periodIndex: 1,
        declaration: window,
        payment: window,
        amount: round2(amount),
        absorbed: false,
        instalment: 1,
        instalments: 1,
        status: settlement ? 'paid' : window.to < today ? 'overdue' : 'upcoming',
        paidOn: settlement?.happenedOn ?? null,
        paidAmount: settlement ? settlement.amount : null,
      })
    }
  }
  schedule.sort((a, b) => a.payment.to.localeCompare(b.payment.to) || a.levyName.localeCompare(b.levyName))

  // --- monthly lines ----------------------------------------------------------
  const monthLines: StatementMonth[] = []
  for (const month of months) {
    const window = { from: month.from, to: month.to > asOf ? asOf : month.to }
    const empty = month.from > asOf
    const monthly = empty ? null : await ledger.measures(window)
    const provisions = provisionPerMonth[month.index - 1]!
    monthLines.push({
      month: `${month.from.slice(0, 7)}-01`,
      revenue: round2(monthly?.revenue ?? 0),
      provisions: round2(provisions),
      expenses: round2(monthly?.expenses ?? 0),
      net: round2((monthly?.revenue ?? 0) - (monthly?.expenses ?? 0) - provisions),
      paidToSelf: empty ? 0 : round2(await paidToSelfDs(sql, scope, window)),
      running: month.from <= today && today <= month.to,
    })
  }

  // --- what may be taken out --------------------------------------------------
  const reserve = statementLevies.reduce((sum, l) => sum + l.reserve, 0)
  const commitments = await activityCommitmentsDue(userId, activityId, today)
  const provisions = statementLevies.filter((l) => !l.passThrough).reduce((sum, l) => sum + l.accrued, 0)
  const provisionsPassThrough = statementLevies
    .filter((l) => l.passThrough)
    .reduce((sum, l) => sum + l.accrued, 0)

  // --- thresholds -------------------------------------------------------------
  const statementThresholds: StatementThreshold[] = []
  const yearPeriod = periodsOf(fiscalYear, cal, 'year')[0]!
  for (const threshold of thresholds) {
    const window = resolvePeriodRef(threshold.periodRef, yearPeriod, cal)
    const clamped = { from: window.from, to: window.to > asOf ? asOf : window.to }
    const current =
      threshold.measure === 'withholding_share'
        ? await withholdingShare(sql, scope, clamped)
        : (MEASURE_OF[threshold.measure]?.(await ledger.measures(clamped)) ?? 0)
    const value = Number(threshold.value)
    statementThresholds.push({
      id: threshold.id,
      label: threshold.label,
      measure: threshold.measure,
      periodRef: threshold.periodRef,
      comparison: threshold.comparison,
      value,
      current: round2(current),
      progress: value === 0 ? 0 : round2(current / value),
      breached: threshold.comparison === 'lte' ? current > value : current < value,
      consequence: threshold.consequence,
      sourceUrl: threshold.sourceUrl,
      verifiedOn: threshold.verifiedOn,
      reviewOn: threshold.reviewOn,
    })
  }

  return {
    activity: {
      id: activity.id,
      name: activity.name,
      regimeLabel: activity.regimeLabel,
      currency: activity.currency,
      startedOn: activity.startedOn,
      closedOn: activity.closedOn,
      revenueBasis: activity.revenueBasis,
      vatRegistered: activity.vatRegistered,
      deductibleExpenses: activity.deductibleExpenses,
      fiscalYear,
      period: year,
      monthsOpen: monthsOpen(year, cal, activity.startedOn, activity.closedOn),
    },
    asOf,
    basis: activity.revenueBasis,
    totals: {
      revenue: round2(measures.revenue),
      revenueOtherBasis: { basis: otherBasis, revenue: round2(otherRevenue) },
      revenueInclVat: round2(measures.revenueInclVat),
      expenses: round2(measures.expenses),
      provisions: round2(provisions),
      provisionsPassThrough: round2(provisionsPassThrough),
      net: round2(measures.revenue - measures.expenses - provisions),
      paidToSelf: round2(paidToSelfYear),
      vatCollected: round2(measures.vatCollected),
      vatDeductible: round2(measures.vatDeductible),
      withholdings: round2(measures.withholdings),
    },
    months: monthLines,
    levies: statementLevies,
    schedule,
    reserve: round2(reserve),
    payableToSelf: {
      treasury: round2(treasuryNow),
      reserve: round2(reserve),
      commitments: round2(commitments),
      amount: round2(treasuryNow - reserve - commitments),
    },
    revenueByClient: clients,
    expensesByCategory: categories,
    thresholds: statementThresholds,
  }
}

/**
 * What the activity's commitments still take out of it before the month ends,
 * occurrences already past their date included: money already spoken for is
 * not payable to oneself. Only what leaves counts; a recurring income is not a
 * charge.
 */
async function activityCommitmentsDue(userId: string, activityId: string, today: string): Promise<number> {
  const horizon = endOfMonth(today)
  const pending = await pendingOccurrences(userId, horizon)
  return pending
    .filter(
      (o) =>
        o.commitment.activityId === activityId && o.commitment.direction === 'outgoing' && o.dueOn <= horizon,
    )
    .reduce((sum, o) => sum + o.amount, 0)
}

/**
 * The rules of an activity, for a caller that has to name one (settling a due
 * date, showing what a regime is made of). Every row is returned, closed
 * validities included: a rate that changed left the row that computed the
 * years before it.
 */
export async function activityLevies(userId: string, activityId: string): Promise<Levy[]> {
  return await listLevies(db(), userId, activityId)
}

// ---------------------------------------------------------------------------
// Settling a due date
// ---------------------------------------------------------------------------

export interface ConfirmLevyPaymentInput {
  levyId: string
  /** The period being settled, by its first day; a regularisation names the year it settles. */
  periodStart: string
  /** What actually left, which is the assessment and not necessarily the estimate. */
  amount: number
  date: string
  /** The account it left, which the rule's own activity owns. */
  accountId: string
  /** Who was paid: the tax office, the social fund. */
  actorId: string
  note?: string
}

/**
 * Records the settlement of a due date: an expense of the activity, in the
 * rule's settlement category, from one of its accounts. That expense is what
 * makes the reserve fall, so it is written the same way whether the schedule,
 * a screen or an AI asks for it, and it is a movement like any other
 * afterwards (correct it, delete it).
 *
 * The amount is the one that really left. An assessment differing from the
 * estimate is the normal case, and seeing that gap is the point: nothing here
 * rewrites the provision to match.
 */
export async function confirmLevyPayment(userId: string, input: ConfirmLevyPaymentInput) {
  const sql = db()
  const [row] = await sql<Levy[]>`
    select * from levy where user_id = ${userId} and id = ${input.levyId}
  `
  if (!row) throw new DomainError('levy_not_found', `No rule ${input.levyId} for this user`)
  if (!row.settlementCategoryId)
    throw new DomainError(
      'levy_has_no_settlement_category',
      `"${row.name}" says nothing about where its payments are filed: give it a settlement category first.`,
    )
  if (!(input.amount > 0)) throw new DomainError('bad_amount', 'An amount is always positive')
  return await declareMovement(userId, {
    happenedOn: input.date,
    amount: input.amount,
    sourceAccountId: input.accountId,
    targetActorId: input.actorId,
    categoryId: row.settlementCategoryId,
    activityId: row.activityId,
    note: input.note ?? `${row.name} ${input.periodStart}`,
  })
}
