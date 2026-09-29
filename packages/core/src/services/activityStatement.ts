import { db, type Executor } from '../db/client.ts'
import { activitiesSharing, getActivity, getCategory } from '../db/datasources/catalog.ts'
import { deleteNilReturn, insertNilReturn } from '../db/datasources/levies.ts'
import {
  type ActivityScope,
  activityScope,
  type CategoryTotal,
  expensesByCategory,
  levyNilReturns,
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
  type TreasuryAccount,
  treasuryAccounts,
  withholdingShare,
} from '../db/datasources/measures.ts'
import { setLevyDue } from '../db/datasources/movements.ts'
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
  fiscalYearOf,
  fiscalYearRange,
  inputAt,
  type LevyResult,
  type ModifierSpec,
  modifiersFor,
  monthsOpen,
  periodsOf,
  periodsPerYear,
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
  LevyDue,
  LevyEntry,
  LevyKind,
  LevyModifier,
  LevyPeriod,
  LevyStatus,
  PeriodRef,
  RevenueBasis,
  ThresholdMeasure,
} from '../domain/types.ts'
import { pendingOccurrences } from './commitments.ts'
import { declareMovementIn } from './movements.ts'

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
 * (the treasury the activity's accounts hold, less that reserve, less what any
 * other activity living on those same accounts owes, less the commitments of
 * the month), while the net is a flow.
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
  /** Accrued provisions of the rules that are a charge, as the totals count them. */
  provisions: number
  /** Accrued provisions of the pass-through rules: owed, but never a charge. */
  provisionsPassThrough: number
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

/**
 * Where a due date stands. `paid`: a payment answers it. `nil_return`: the
 * user said its return was filed at zero, which is what answers a period with
 * nothing in it, since no payment of zero exists (migration 0023).
 * `nothing_due`: it comes to zero and files nothing of its own, because its
 * rule reads none of the activity's figures (see `filedOnFigures`) or the
 * period rides in another return. Otherwise `upcoming`, then `overdue` once
 * its window has closed.
 */
export type ScheduleStatus = 'paid' | 'nil_return' | 'nothing_due' | 'upcoming' | 'overdue'

export interface ScheduleEntry {
  levyId: string
  levyName: string
  levyKind: LevyKind
  /** A period of the year, or the settlement of a closed year. */
  entry: LevyEntry
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
  /** What answered it, when anything did: the last day money left against it, and the total. */
  paidOn: string | null
  paidAmount: number | null
  /** Stated figures the estimate needed and was never given: its amount is unknown, not zero. */
  missingInputs: string[]
  /** The user said its return was filed at zero; that answers it only while the estimate is zero. */
  nilReturn: boolean
}

/** What another activity living on the same accounts is keeping for what it owes. */
export interface SharedReserve {
  activityId: string
  activityName: string
  reserve: number
  /**
   * True when that activity's own statement will not compute, because one of
   * its rules carries parameters the engine cannot read. Its reserve is then
   * unknown, not zero, and the screen has to say so rather than hand out money
   * that may already be owed.
   */
  unreadable: boolean
}

export interface PayableToSelf {
  /** The accounts the activity lives on, each saying whom it is shared with. */
  accounts: TreasuryAccount[]
  /** What those accounts hold today, whole: nothing is apportioned. */
  treasury: number
  /** The sum of the reserves, VAT included: it is owed. */
  reserve: number
  /** The reserves of the other activities living on those same accounts. */
  shared: SharedReserve[]
  /** Σ of `shared`, taken off too, so the same euro is never promised twice. */
  sharedReserve: number
  /** Occurrences of the activity's commitments due between today and the end of the month. */
  commitments: number
  /** `treasury − reserve − sharedReserve − commitments`, which may be negative. */
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

/**
 * The periods of a fiscal year a rule governs: those its validity covers on
 * their closing day, and during which the activity was open. A rate replaced
 * on a date is a new row, so the day a period closes is what tells the two
 * rows apart, exactly as it tells which modifiers a period was computed
 * with.
 */
function governedPeriods(
  row: Levy,
  activity: Activity,
  cal: FiscalCalendar,
  fiscalYear: number,
): FiscalPeriod[] {
  return periodsOf(fiscalYear, cal, row.period).filter((p) => {
    if (row.validFrom > p.to) return false
    if (row.validTo && row.validTo < p.to) return false
    if (activity.startedOn && activity.startedOn > p.to) return false
    if (activity.closedOn && activity.closedOn < p.from) return false
    return true
  })
}

function windowsOf(levy: ParsedLevy, period: FiscalPeriod, activity: Activity, cal: FiscalCalendar) {
  return dueWindows(period, levy.due, cal, {
    declarationLagMonths: levy.row.declarationLagMonths,
    firstDueAfterDays: levy.row.firstDueAfterDays,
    activityStartedOn: activity.startedOn,
    skipPeriods: levy.skipPeriods,
  })
}

/** What one period of one rule came to, and everything the screen says about it. */
interface PeriodResult {
  period: FiscalPeriod
  result: LevyResult
  /** Signed amount owed for the period, after credits and after the pro rata of a running period. */
  amount: number
  /** The share of the period already lived through, 1 for a closed one. */
  elapsed: number
  /** Stated figures read and never given, each standing in as zero. */
  missingInputs: string[]
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

  /** A stated figure an amount rests on: zero when never given, and said missing. */
  private stated(name: string | null, on: string, missing: Set<string>): number {
    const value = this.input(name, on)
    if (value === null && name) missing.add(name)
    return value ?? 0
  }

  governedPeriods(levy: ParsedLevy, fiscalYear: number): FiscalPeriod[] {
    return governedPeriods(levy.row, this.activity, this.cal, fiscalYear)
  }

  /**
   * A measure over a window, scaled up to the whole window when it is still
   * running. A stated figure never given reads as zero, and its name goes into
   * `missing` so the zero is not taken for a known one.
   */
  private async measure(
    measure: string,
    range: DateRange,
    scale: number,
    levyId: string | null,
    inputName: string | null,
    seen: Set<string>,
    missing: Set<string>,
  ): Promise<number> {
    switch (measure) {
      case 'none':
        return 0
      case 'input':
        return this.stated(inputName, range.to, missing)
      case 'paid':
        return levyId ? this.paidOver(levyId, range) * scale : 0
      case 'amount':
        return levyId ? await this.amountOf(levyId, range, seen, missing) : 0
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
  private async amountOf(
    levyId: string,
    range: DateRange,
    seen: Set<string>,
    missing: Set<string>,
  ): Promise<number> {
    if (seen.has(levyId))
      throw new DomainError('levy_cycle', 'These rules read each other in a circle: one of them must not.')
    const levy = this.byId.get(levyId)
    if (!levy) return 0
    const chain = new Set(seen).add(levyId)
    let total = 0
    for (let year = Number(range.from.slice(0, 4)) - 1; year <= Number(range.to.slice(0, 4)) + 1; year++) {
      for (const period of this.governedPeriods(levy, year)) {
        if (period.to < range.from || period.to > range.to) continue
        const evaluated = await this.evaluate(levy, period, chain)
        total += evaluated.amount
        for (const name of evaluated.missingInputs) missing.add(name)
      }
    }
    return total
  }

  private amountInput(levy: ParsedLevy, period: FiscalPeriod, missing: Set<string>): AmountInput {
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
          settledLater: row.regularization !== 'none',
        }
      case 'fixed':
        return {
          form: 'fixed',
          amount:
            row.fixedAmount !== null
              ? Number(row.fixedAmount)
              : this.stated(row.fixedInputName, period.to, missing),
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
    baseRefOverride?: PeriodRef,
  ): Promise<PeriodResult> {
    const row = levy.row
    const baseRange = resolvePeriodRef(baseRefOverride ?? row.basePeriodRef, period, this.cal)
    const baseScale = projection(baseRange, this.on)
    const missing = new Set<string>()
    const measure = await this.measure(
      row.baseMeasure,
      baseRange,
      baseScale,
      row.baseLevyId,
      row.baseInputName,
      seen,
      missing,
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
        missing,
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
          missing,
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
        periodsPerYear: periodsPerYear(row.period),
      },
      amount: this.amountInput(levy, period, missing),
      modifiers: effectsOf(modifiersFor(levy.modifiers, period, this.activity.startedOn, this.cal)),
      credits,
      fixedCredit: row.fixedCredit === null ? null : Number(row.fixedCredit),
      inputCredit: this.input(row.creditInputName, period.to),
    })
    // A period still running owes what it has lived through: the figures were
    // read scaled to the whole period just above (a schedule has to be read on
    // a whole year), so the amount comes back down here.
    const elapsed = period.to <= this.on ? 1 : period.from > this.on ? 0 : 1 / projection(period, this.on)
    return { period, result, amount: result.net * elapsed, elapsed, missingInputs: [...missing] }
  }

  /**
   * What a rule with a regularisation owes for a closed year, beyond what its
   * periods provisioned. A dead zone compares the base chosen every month with
   * the row the definitive figures name, and owes nothing while it sits inside
   * it; a provisional rule owes the difference between the definitive amount
   * and what was provisioned.
   *
   * The periods of a rule that settles provisioned the chosen base exactly as
   * it was declared, bounded by nothing (see `electiveResolution`), so the gap
   * computed here is the whole of it and is owed once.
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
    // The periods ran on an older year or on a stated figure; the definitive
    // amount is the same rule read on the closed year itself, which is what
    // `ytd` names on its last period. That gives one period's worth at the
    // definitive figures, so the year is that many periods.
    const definitive = await this.evaluate(levy, last, new Set(), 'ytd')
    let provisional = 0
    for (const period of periods) provisional += (await this.evaluate(levy, period)).amount
    return settlementDifference(definitive.result.net * periods.length, provisional)
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

function scheduleStatus(window: DueWindow, on: string, paidBy: Settlement[]): ScheduleStatus {
  if (paidBy.length > 0) return 'paid'
  return window.payment.to < on ? 'overdue' : 'upcoming'
}

/**
 * Whether a rule is filed on a return stating the activity's own figures. One
 * whose base is such a figure (its receipts, its profit, its VAT balance) is,
 * and that return is owed at zero too: its period stays due until a payment
 * or a nil return answers it. One whose amount comes from elsewhere (a
 * notice, a stated figure, another rule's amount) has nothing of the activity
 * to state, so at zero nothing is filed and nothing is paid. The distinction
 * only ever decides a zero: an amount to pay is due either way.
 */
function filedOnFigures(row: Levy): boolean {
  return row.baseMeasure in MEASURE_OF
}

function paidFields(paidBy: Settlement[]): Pick<ScheduleEntry, 'paidOn' | 'paidAmount'> {
  if (paidBy.length === 0) return { paidOn: null, paidAmount: null }
  return {
    paidOn: paidBy[paidBy.length - 1]!.happenedOn,
    paidAmount: round2(paidBy.reduce((sum, s) => sum + s.amount, 0)),
  }
}

function sameDue(a: LevyDue, b: LevyDue): boolean {
  return (
    a.levyId === b.levyId &&
    a.entry === b.entry &&
    a.periodStart === b.periodStart &&
    a.instalment === b.instalment
  )
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
  return await buildStatement(userId, activityId, fiscalYear, today, true)
}

/**
 * What the other activities living on the same accounts are keeping for what
 * they owe. Their reserve is taken off this activity's payable, because the
 * money is one pile: telling each activity it may take its own share of that
 * pile would promise twice the euros that will pay the other one's levies.
 * The prudent reading is the only one that never over-promises, and it
 * apportions nothing: each activity simply sees everything the accounts still
 * owe before anything may leave them.
 *
 * Each is read on the day this statement is read as of, on whichever of its
 * own fiscal years holds that day: two activities never share a calendar, and
 * a reserve is what was owed on a day. Each is read without this step of its
 * own, which is what stops two activities sharing an account from waiting on
 * each other forever.
 */
async function sharedReserves(userId: string, scope: ActivityScope, asOf: string): Promise<SharedReserve[]> {
  const others = await activitiesSharing(db(), userId, scope.activityId, scope.sharedAccountIds, asOf)
  const shared: SharedReserve[] = []
  for (const other of others) {
    const cal = { startMonth: other.fiscalYearStartMonth, startDay: other.fiscalYearStartDay }
    let statement: ActivityStatement
    try {
      statement = await buildStatement(userId, other.id, fiscalYearOf(asOf, cal), asOf, false)
    } catch (e) {
      // A neighbour misconfigured in a corner of its own settings must not take
      // down this activity's statement: what it owes becomes unknown, which the
      // screen says, instead of an exception on a page about something else.
      if (!(e instanceof DomainError && e.code === 'levy_misconfigured')) throw e
      shared.push({ activityId: other.id, activityName: other.name, reserve: 0, unreadable: true })
      continue
    }
    if (statement.reserve > 0)
      shared.push({
        activityId: other.id,
        activityName: other.name,
        reserve: statement.reserve,
        unreadable: false,
      })
  }
  return shared
}

async function buildStatement(
  userId: string,
  activityId: string,
  fiscalYear: number,
  today: string,
  /** False while reading another activity's reserve, which is what stops the recursion. */
  withShared: boolean,
): Promise<ActivityStatement> {
  const sql = db()
  const activity = await getActivity(sql, userId, activityId)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
  if (activity.kind !== 'business')
    throw new DomainError(
      'activity_not_business',
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
  const [modifiers, nilReturns] = await Promise.all([
    listLevyModifiers(
      sql,
      rows.map((r) => r.id),
    ),
    levyNilReturns(
      sql,
      userId,
      rows.map((r) => r.id),
    ),
  ])
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
  const [otherRevenue, paidToSelfYear, accounts, clients, categories] = await Promise.all([
    readRevenue(sql, scope, soFar, otherBasis),
    paidToSelfDs(sql, scope, soFar),
    treasuryAccounts(sql, scope, today),
    revenueByClient(sql, scope, soFar),
    expensesByCategory(sql, scope, soFar),
  ])
  const treasuryNow = accounts.reduce((sum, a) => sum + a.balance, 0)

  // --- rule by rule -----------------------------------------------------------
  const months = monthsOfYear(fiscalYear, cal)
  // Kept apart the way the totals keep them: a pass-through rule is money
  // owed and collected for someone else, so it never enters a net, and a
  // column that mixed the two would not add up to the total under it.
  const provisionPerMonth = new Array(months.length).fill(0)
  const passThroughPerMonth = new Array(months.length).fill(0)
  const statementLevies: StatementLevy[] = []
  const schedule: ScheduleEntry[] = []
  const categoryNames = new Map<string, string>()
  // The settlements naming no due date that one has already been credited with.
  const claimed = new Set<string>()
  // What answers a due date. A payment that named it answers it and no other,
  // whatever day the money left: an early payment is not the late settlement
  // of the window before, nor a late one the settlement of the window after.
  // Failing one, the first payment naming none that fell inside the window,
  // give or take the tolerance; and one such payment answers one due date,
  // or a single payment would clear a year.
  const answer = (due: LevyDue, window: DateRange): Settlement[] => {
    const named = engine.settlements(due.levyId).filter((s) => s.due !== null && sameDue(s.due, due))
    if (named.length > 0) return named
    const dated = engine
      .settlements(due.levyId, widened(window, SETTLEMENT_TOLERANCE_DAYS))
      .find((s) => s.due === null && !claimed.has(s.movementId))
    if (!dated) return []
    claimed.add(dated.movementId)
    return [dated]
  }
  for (const id of settlementCategories) {
    const category = await getCategory(sql, userId, id)
    if (category) categoryNames.set(id, category.name)
  }

  for (const levy of levies) {
    const row = levy.row
    const periods = engine.governedPeriods(levy, fiscalYear)
    // A rule whose validity ended before this year is read all the same: the
    // year it last governed may be settled inside this one. It has no row of
    // its own here, only that dated entry.
    const governedBefore = engine.governedPeriods(levy, fiscalYear - 1).length > 0
    if (periods.length === 0 && !governedBefore) continue
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
      // Months the activity was actually open: a yearly rule spread over the
      // whole year would otherwise provision in months that came before the
      // activity existed, and show a net in the red for each of them.
      const begun = months.filter(
        (m) =>
          m.from >= period.from &&
          m.from <= period.to &&
          m.from <= asOf &&
          (!activity.startedOn || m.to >= activity.startedOn) &&
          (!activity.closedOn || m.from <= activity.closedOn),
      )
      const perMonth = row.passThrough ? passThroughPerMonth : provisionPerMonth
      for (const month of begun) perMonth[month.index - 1]! += evaluated.amount / begun.length

      for (const window of windowsOf(levy, period, activity, cal)) {
        const due: LevyDue = {
          levyId: row.id,
          entry: 'period',
          periodStart: period.from,
          instalment: window.instalment,
        }
        const paidBy = answer(due, window.payment)
        // A period whose figures are not in yet estimates nothing; the window
        // is still worth listing, because the return is owed either way.
        const share = window.instalments > 1 ? 1 / window.instalments : 1
        const amount = round2(evaluated.result.net * share)
        const nilReturn = nilReturns.some((n) => sameDue(n, due))
        // A zero resting on a figure never stated is unknown, and nothing
        // answers it but that figure, or a payment.
        const zero = amount === 0 && evaluated.missingInputs.length === 0
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
          amount,
          absorbed: window.absorbed,
          instalment: window.instalment,
          instalments: window.instalments,
          status:
            paidBy.length === 0 && zero && nilReturn
              ? 'nil_return'
              : paidBy.length === 0 && zero && (window.absorbed || !filedOnFigures(row))
                ? 'nothing_due'
                : scheduleStatus(window, today, paidBy),
          ...paidFields(paidBy),
          missingInputs: evaluated.missingInputs,
          nilReturn,
        })
      }
    }
    // A rule whose periods are all closed accrues what they came to; one still
    // living through a period accrues that period pro rata (see AccrualMethod).
    const accrualMethod: AccrualMethod = current === null ? 'closed_periods' : 'prorated'
    const paid = engine.settlements(row.id, soFar).reduce((sum, s) => sum + s.amount, 0)
    if (periods.length > 0)
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
      const paidBy = answer(
        {
          levyId: row.id,
          entry: 'regularization',
          periodStart: fiscalYearRange(settled, cal).from,
          instalment: 1,
        },
        window,
      )
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
        status: paidBy.length > 0 ? 'paid' : window.to < today ? 'overdue' : 'upcoming',
        ...paidFields(paidBy),
        missingInputs: [],
        nilReturn: false,
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
      provisionsPassThrough: round2(passThroughPerMonth[month.index - 1]!),
      expenses: round2(monthly?.expenses ?? 0),
      net: round2((monthly?.revenue ?? 0) - (monthly?.expenses ?? 0) - provisions),
      paidToSelf: empty ? 0 : round2(await paidToSelfDs(sql, scope, window)),
      running: month.from <= today && today <= month.to,
    })
  }

  // --- what may be taken out --------------------------------------------------
  const reserve = statementLevies.reduce((sum, l) => sum + l.reserve, 0)
  const shared = withShared ? await sharedReserves(userId, scope, asOf) : []
  const sharedReserve = shared.reduce((sum, other) => sum + other.reserve, 0)
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
      accounts,
      treasury: round2(treasuryNow),
      reserve: round2(reserve),
      shared,
      sharedReserve: round2(sharedReserve),
      commitments: round2(commitments),
      amount: round2(treasuryNow - reserve - sharedReserve - commitments),
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
  /** A period unless said otherwise: a year's settlement opens on the same day as its first period. */
  entry?: LevyEntry
  /** Which instalment of the period, when it is paid in several: the first unless said otherwise. */
  instalment?: number
  /** What actually left, which is the assessment and not necessarily the estimate. */
  amount: number
  date: string
  /** The account it left, one of those the rule's activity lives on. */
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
 * The due date is named, never inferred from the day the money left: the
 * payment answers that one in the schedule however early or late it was
 * made. A due date the rule does not have is refused, because a payment
 * answering nothing would lower the reserve and leave the period it paid
 * proposed for payment.
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
  const categoryId = row.settlementCategoryId
  if (!categoryId)
    throw new DomainError(
      'levy_has_no_settlement_category',
      `"${row.name}" says nothing about where its payments are filed: give it a settlement category first.`,
    )
  if (!(input.amount > 0)) throw new DomainError('bad_amount', 'An amount is always positive')
  const due: LevyDue = {
    levyId: row.id,
    entry: input.entry ?? 'period',
    periodStart: input.periodStart,
    instalment: input.instalment ?? 1,
  }
  const activity = await getActivity(sql, userId, row.activityId)
  if (!activity || !hasDue(parseLevy(row, []), activity, due)) throw dueNotFound(row, due)
  return await sql.begin(async (tx) => {
    const movement = await declareMovementIn(tx, userId, {
      happenedOn: input.date,
      amount: input.amount,
      sourceAccountId: input.accountId,
      targetActorId: input.actorId,
      categoryId,
      activityId: row.activityId,
      note: input.note ?? `${row.name} ${input.periodStart}`,
    })
    return await setLevyDue(tx, movement.id, due)
  })
}

function dueNotFound(row: Levy, due: LevyDue): DomainError {
  return new DomainError(
    'levy_due_not_found',
    `"${row.name}" has no ${due.entry === 'regularization' ? 'settlement of a year' : 'period'} starting ${due.periodStart}${due.instalment > 1 ? `, instalment ${due.instalment}` : ''}`,
  )
}

/** A due date as a caller names it: the period is the first due date of it unless said otherwise. */
export type DueDateInput = Pick<ConfirmLevyPaymentInput, 'levyId' | 'periodStart' | 'entry' | 'instalment'>

function namedDue(input: DueDateInput): LevyDue {
  return {
    levyId: input.levyId,
    entry: input.entry ?? 'period',
    periodStart: input.periodStart,
    instalment: input.instalment ?? 1,
  }
}

async function requireLevyRow(userId: string, levyId: string): Promise<Levy> {
  const [row] = await db()<Levy[]>`select * from levy where user_id = ${userId} and id = ${levyId}`
  if (!row) throw new DomainError('levy_not_found', `No rule ${levyId} for this user`)
  return row
}

/**
 * Records that the return of a due date was filed at zero: that is what
 * answers a period with nothing in it, since no payment of zero can be
 * written. Saying it twice changes nothing.
 *
 * The due date is read as the statement reads it on the day, and refused when
 * a zero return would state something false or needless: a due date the rule
 * does not have; one that files nothing of its own (`nothing_due`); a period
 * still running, whose figures are not in; an estimate resting on a figure
 * never stated, which is unknown rather than zero; and an estimate that is not
 * zero, because declaring nothing over receipts the facts record is a mistake
 * on one side or the other, to be found rather than written over.
 */
export async function confirmNilReturn(
  userId: string,
  input: DueDateInput,
  today: string = todayOf(),
): Promise<void> {
  const row = await requireLevyRow(userId, input.levyId)
  const due = namedDue(input)
  const activity = await getActivity(db(), userId, row.activityId)
  if (!activity) throw dueNotFound(row, due)
  const fiscalYear = fiscalYearOf(due.periodStart, {
    startMonth: activity.fiscalYearStartMonth,
    startDay: activity.fiscalYearStartDay,
  })
  const statement = await buildStatement(userId, activity.id, fiscalYear, today, false)
  const entry = statement.schedule.find(
    (e) =>
      e.levyId === due.levyId &&
      e.entry === due.entry &&
      e.period.from === due.periodStart &&
      e.instalment === due.instalment,
  )
  if (!entry) throw dueNotFound(row, due)
  const what = `"${row.name}" for the period starting ${due.periodStart}`
  if (entry.status === 'nothing_due')
    throw new DomainError(
      'levy_files_no_return',
      `${what} comes to zero and files nothing of its own: there is no return to confirm`,
    )
  if (entry.period.to >= today)
    throw new DomainError(
      'levy_period_running',
      `${what} runs until ${entry.period.to}: its figures are not in`,
    )
  if (entry.missingInputs.length > 0)
    throw new DomainError(
      'levy_amount_unknown',
      `${what} rests on ${entry.missingInputs.join(', ')}, never stated: its amount is unknown, not zero`,
    )
  if (entry.amount !== 0)
    throw new DomainError('levy_due_not_nil', `${what} is estimated at ${entry.amount}, not zero`)
  await insertNilReturn(db(), userId, due)
}

/**
 * Takes back a return said filed at zero by mistake: its period is owed
 * again. One that was never said is refused, because the caller then named a
 * due date other than the one it meant.
 */
export async function withdrawNilReturn(userId: string, input: DueDateInput): Promise<void> {
  const row = await requireLevyRow(userId, input.levyId)
  const due = namedDue(input)
  if ((await deleteNilReturn(db(), userId, due)) === 0)
    throw new DomainError(
      'nil_return_not_found',
      `"${row.name}" has no return filed at zero for the period starting ${due.periodStart}`,
    )
}

/** Whether the schedule of a rule lists that due date, read as the statement reads it. */
function hasDue(levy: ParsedLevy, activity: Activity, due: LevyDue): boolean {
  const cal: FiscalCalendar = {
    startMonth: activity.fiscalYearStartMonth,
    startDay: activity.fiscalYearStartDay,
  }
  const fiscalYear = fiscalYearOf(due.periodStart, cal)
  const governed = governedPeriods(levy.row, activity, cal, fiscalYear)
  if (due.entry === 'regularization')
    return (
      levy.row.regularization !== 'none' &&
      due.instalment === 1 &&
      due.periodStart === fiscalYearRange(fiscalYear, cal).from &&
      governed.length > 0
    )
  const period = governed.find((p) => p.from === due.periodStart)
  return period !== undefined && due.instalment <= windowsOf(levy, period, activity, cal).length
}
