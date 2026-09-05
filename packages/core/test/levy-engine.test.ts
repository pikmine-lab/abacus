import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Brackets, Due, Elective } from '../src/domain/levy.ts'
import {
  abatementOf,
  applyCredits,
  computeAmount,
  deadzoneAdjustment,
  dueWindows,
  effectsOf,
  electiveResolution,
  evaluateLevy,
  fiscalYearOf,
  fiscalYearRange,
  inputAt,
  modifierRange,
  modifiersFor,
  monthsElapsed,
  monthsOpen,
  nextPeriod,
  periodContaining,
  periodsOf,
  progressiveAmount,
  proratedAnnual,
  regularizationWindow,
  resolveBase,
  resolvePeriodRef,
  round2,
  rowFor,
  settlementDifference,
  stepAmount,
  widened,
} from '../src/domain/levy-engine.ts'

/**
 * Every figure below is a fixture taken from the two control configurations
 * of the design (a French micro-entreprise in 2026, an autónomo in Bizkaia in
 * 2027) and their sourced research. None of them lives in the code: the engine
 * only knows the grammar these tables are written in.
 */

const CIVIL = { startMonth: 1, startDay: 1 }
const UK = { startMonth: 4, startDay: 6 }

/** Bizkaia income tax schedule, NF 13/2013 art. 75.1 as of 1 January 2026. */
const FORAL_SCHEDULE: Brackets = {
  mode: 'progressive',
  rows: [
    { upTo: 18080, rate: 23 },
    { upTo: 36160, rate: 28 },
    { upTo: 54240, rate: 35 },
    { upTo: 77450, rate: 40 },
    { upTo: 107260, rate: 45 },
    { upTo: 142960, rate: 46 },
    { upTo: 208390, rate: 47 },
    { upTo: null, rate: 49 },
  ],
}

/** RETA 2026 table (Orden PJC/297/2026 art. 18.1) and the global 31.50 % rate. */
const RETA: Elective = {
  inputName: 'contribution_base',
  rate: 31.5,
  rows: [
    { upTo: 670, minBase: 653.59, maxBase: 718.94 },
    { upTo: 900, minBase: 718.95, maxBase: 900 },
    { upTo: 1166.69, minBase: 849.67, maxBase: 1166.7 },
    { upTo: 1300, minBase: 950.98, maxBase: 1300 },
    { upTo: 1500, minBase: 960.78, maxBase: 1500 },
    { upTo: 1700, minBase: 960.78, maxBase: 1700 },
    { upTo: 1850, minBase: 1143.79, maxBase: 1850 },
    { upTo: 2030, minBase: 1209.15, maxBase: 2030 },
    { upTo: 2330, minBase: 1274.51, maxBase: 2330 },
    { upTo: 2760, minBase: 1356.21, maxBase: 2760 },
    { upTo: 3190, minBase: 1437.91, maxBase: 3190 },
    { upTo: 3620, minBase: 1519.61, maxBase: 3620 },
    { upTo: 4050, minBase: 1601.31, maxBase: 4050 },
    { upTo: 6000, minBase: 1732.03, maxBase: 5101.2 },
    { upTo: null, minBase: 1928.1, maxBase: 5101.2 },
  ],
}

/** Foral flat abatement by last year's profit, NF 13/2013 art. 28.1.b. */
const FORAL_ABATEMENT = {
  brackets: [
    { upTo: 35000, rate: 20 },
    { upTo: 85000, rate: 15 },
    { upTo: null, rate: 10 },
  ],
  on: { measure: 'profit' as const, periodRef: 'year-1' as const },
}

// ---------------------------------------------------------------------------
// Fiscal calendar
// ---------------------------------------------------------------------------

test('a civil fiscal year runs from 1 January to 31 December', () => {
  assert.deepEqual(fiscalYearRange(2026, CIVIL), { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(fiscalYearOf('2026-07-15', CIVIL), 2026)
})

test('a fiscal year opening on 6 April is named by the year it opens in', () => {
  assert.deepEqual(fiscalYearRange(2026, UK), { from: '2026-04-06', to: '2027-04-05' })
  assert.equal(fiscalYearOf('2026-04-05', UK), 2025)
  assert.equal(fiscalYearOf('2026-04-06', UK), 2026)
  assert.equal(fiscalYearOf('2027-01-31', UK), 2026)
})

test('periods cut the fiscal year evenly and are indexed from 1', () => {
  const quarters = periodsOf(2027, CIVIL, 'quarter')
  assert.equal(quarters.length, 4)
  assert.deepEqual(quarters[0], {
    fiscalYear: 2027,
    unit: 'quarter',
    index: 1,
    from: '2027-01-01',
    to: '2027-03-31',
  })
  assert.deepEqual(quarters[3], {
    fiscalYear: 2027,
    unit: 'quarter',
    index: 4,
    from: '2027-10-01',
    to: '2027-12-31',
  })
  const months = periodsOf(2026, UK, 'month')
  assert.equal(months.length, 12)
  assert.deepEqual([months[0]!.from, months[0]!.to], ['2026-04-06', '2026-05-05'])
  assert.deepEqual([months[11]!.from, months[11]!.to], ['2027-03-06', '2027-04-05'])
  assert.deepEqual(periodsOf(2026, CIVIL, 'half')[1], {
    fiscalYear: 2026,
    unit: 'half',
    index: 2,
    from: '2026-07-01',
    to: '2026-12-31',
  })
  assert.equal(periodsOf(2026, CIVIL, 'year')[0]!.to, '2026-12-31')
})

test('the period containing a date, and the one after it, follow the fiscal calendar', () => {
  const q = periodContaining('2027-05-15', CIVIL, 'quarter')
  assert.equal(q.index, 2)
  assert.deepEqual(nextPeriod(q, CIVIL).index, 3)
  const last = periodContaining('2027-12-31', CIVIL, 'quarter')
  const rolled = nextPeriod(last, CIVIL)
  assert.deepEqual([rolled.fiscalYear, rolled.index], [2028, 1])
})

test('period references resolve to the period, the year, the years before, or twelve months', () => {
  const q2 = periodsOf(2027, CIVIL, 'quarter')[1]!
  assert.deepEqual(resolvePeriodRef('current', q2, CIVIL), { from: '2027-04-01', to: '2027-06-30' })
  assert.deepEqual(resolvePeriodRef('ytd', q2, CIVIL), { from: '2027-01-01', to: '2027-06-30' })
  assert.deepEqual(resolvePeriodRef('year', q2, CIVIL), { from: '2027-01-01', to: '2027-12-31' })
  assert.deepEqual(resolvePeriodRef('year-1', q2, CIVIL), { from: '2026-01-01', to: '2026-12-31' })
  assert.deepEqual(resolvePeriodRef('year-2', q2, CIVIL), { from: '2025-01-01', to: '2025-12-31' })
  assert.deepEqual(resolvePeriodRef('rolling-12', q2, CIVIL), { from: '2026-07-01', to: '2027-06-30' })
})

test('the whole year is one window for every period of it, where the year to date grows', () => {
  const months = periodsOf(2027, CIVIL, 'month')
  const years = months.map((m) => resolvePeriodRef('year', m, CIVIL))
  assert.equal(new Set(years.map((y) => `${y.from}|${y.to}`)).size, 1)
  // A monthly rule assessed on a yearly figure reads the same window all year;
  // the year to date would name a different one every month.
  assert.deepEqual(years[0], { from: '2027-01-01', to: '2027-12-31' })
  assert.deepEqual(resolvePeriodRef('ytd', months[0]!, CIVIL), { from: '2027-01-01', to: '2027-01-31' })
  // A fiscal year that is not the civil one keeps its own bounds.
  assert.deepEqual(resolvePeriodRef('year', periodsOf(2026, UK, 'month')[3]!, UK), {
    from: '2026-04-06',
    to: '2027-04-05',
  })
})

test('months open count the fiscal months the activity was registered in', () => {
  const year = fiscalYearRange(2027, CIVIL)
  assert.equal(monthsOpen(year, CIVIL, '2027-03-15', null), 10)
  assert.equal(monthsOpen(year, CIVIL, '2026-01-01', null), 12)
  assert.equal(monthsOpen(year, CIVIL, '2027-03-15', '2027-09-02'), 7)
  assert.equal(monthsOpen(year, CIVIL, '2028-01-01', null), 0)
  // A UK year is twelve fiscal months, not the thirteen calendar months it touches.
  assert.equal(monthsOpen(fiscalYearRange(2026, UK), UK, null, null), 12)
  assert.equal(monthsElapsed(year, CIVIL, '2027-05-10'), 5)
  assert.equal(monthsElapsed(year, CIVIL, '2026-12-31'), 0)
  assert.equal(monthsElapsed(year, CIVIL, '2028-03-01'), 12)
})

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

test('a dated input is the latest value on or before the date', () => {
  const inputs = [
    { name: 'contribution_base', validFrom: '2027-01-01', value: '960.78' },
    { name: 'contribution_base', validFrom: '2027-07-01', value: '1300' },
    { name: 'marginal_rate', validFrom: '2027-01-01', value: '30' },
  ]
  assert.equal(inputAt(inputs, 'contribution_base', '2027-03-31'), 960.78)
  assert.equal(inputAt(inputs, 'contribution_base', '2027-07-01'), 1300)
  assert.equal(inputAt(inputs, 'contribution_base', '2026-12-31'), null)
  assert.equal(inputAt(inputs, 'unknown', '2027-12-31'), null)
})

// ---------------------------------------------------------------------------
// Bracket tables
// ---------------------------------------------------------------------------

test('a value on a bound belongs to the row that bound closes', () => {
  assert.equal(rowFor(FORAL_ABATEMENT.brackets, 35000).rate, 20)
  assert.equal(rowFor(FORAL_ABATEMENT.brackets, 35000.01).rate, 15)
  assert.equal(rowFor(FORAL_ABATEMENT.brackets, 200000).rate, 10)
  assert.equal(rowFor(FORAL_ABATEMENT.brackets, -500).rate, 20)
})

test('the foral schedule reproduces the published cumulative amounts at every bound', () => {
  const rows = FORAL_SCHEDULE.rows
  assert.equal(round2(progressiveAmount(rows, 18080)), 4158.4)
  assert.equal(round2(progressiveAmount(rows, 36160)), 9220.8)
  assert.equal(round2(progressiveAmount(rows, 54240)), 15548.8)
  assert.equal(round2(progressiveAmount(rows, 77450)), 24832.8)
  assert.equal(round2(progressiveAmount(rows, 107260)), 38247.3)
  assert.equal(round2(progressiveAmount(rows, 142960)), 54669.3)
  assert.equal(round2(progressiveAmount(rows, 208390)), 85421.4)
  assert.equal(round2(progressiveAmount(rows, 250000)), 105810.3)
  assert.equal(round2(progressiveAmount(rows, 40000)), 10564.8)
  assert.equal(progressiveAmount(rows, 0), 0)
  assert.equal(progressiveAmount(rows, -1000), 0)
})

test('a step table applies the row the whole base falls in, as a rate or a flat amount', () => {
  const byRevenue = [
    { upTo: 10000, amount: 200 },
    { upTo: 32600, amount: 500 },
    { upTo: null, rate: 2 },
  ]
  assert.equal(stepAmount(byRevenue, 8000), 200)
  assert.equal(stepAmount(byRevenue, 32600), 500)
  assert.equal(stepAmount(byRevenue, 50000), 1000)
  assert.equal(
    computeAmount({ form: 'brackets', brackets: { mode: 'step', rows: byRevenue } }, 8000).gross,
    200,
  )
})

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

test('a fixed abatement takes its share, never less than its own floor', () => {
  const taken = abatementOf({ rate: 34, minAmount: 305 }, 40000, null)
  assert.deepEqual([round2(taken.amount), taken.rate], [13600, 34])
  assert.deepEqual(abatementOf({ rate: 34, minAmount: 305 }, 500, null), { amount: 305, rate: 34 })
  assert.equal(round2(resolveBase({ measure: 40000, abatement: { rate: 34, minAmount: 305 } }).base), 26400)
  // The floor of the allowance cannot take more than there is.
  assert.equal(resolveBase({ measure: 200, abatement: { rate: 34, minAmount: 305 } }).base, 0)
})

test('a bracket abatement reads its share on the reference measure, here last year profit', () => {
  const base = (reference: number) =>
    resolveBase({ measure: 50000, abatement: FORAL_ABATEMENT, abatementReference: reference })
  assert.equal(base(30000).base, 40000)
  assert.equal(base(30000).abatementRate, 20)
  assert.equal(base(40000).base, 42500)
  assert.equal(base(90000).base, 45000)
  // No previous year: the reference reads as zero, which is the first row.
  assert.equal(base(0).base, 40000)
})

test('a coefficient modifier applies to the yield once abated', () => {
  const r = resolveBase({
    measure: 50000,
    abatement: FORAL_ABATEMENT,
    abatementReference: 30000,
    coefficientModifiers: [0.9],
  })
  assert.equal(round2(r.base), 36000)
})

test('the RETA base re-integrates the contributions, takes the generic deduction, then reads per month', () => {
  const r = resolveBase({
    measure: 30000,
    addBack: 3600,
    coefficient: 0.93,
    scale: 'per_month',
    monthsOpen: 12,
  })
  assert.equal(round2(r.base), 2604)
  // Ten months registered: the same yearly yield reads higher per month.
  assert.equal(
    round2(resolveBase({ measure: 30000, coefficient: 0.93, scale: 'per_month', monthsOpen: 10 }).base),
    2790,
  )
  // Not registered at all: nothing to read.
  assert.equal(resolveBase({ measure: 30000, scale: 'per_month', monthsOpen: 0 }).base, 0)
})

test('annualizing scales a partial year up to twelve months', () => {
  assert.equal(round2(resolveBase({ measure: 25000, scale: 'annualized', monthsOpen: 5 }).base), 60000)
})

test("per period takes the rule's share of a longer measure, whatever the activity lived", () => {
  // A quarterly instalment assessed on a yearly measure takes the quarter, so
  // the rate stays the rate the text fixes instead of carrying a division.
  assert.equal(resolveBase({ measure: 40000, scale: 'per_period', periodsPerYear: 4 }).base, 10000)
  assert.equal(resolveBase({ measure: 40000, scale: 'per_period', periodsPerYear: 12 }).base, 40000 / 12)
  // A yearly rule reads the whole of it, and the count is the calendar's, not
  // the months the activity was open: it never falls to zero.
  assert.equal(resolveBase({ measure: 40000, scale: 'per_period', periodsPerYear: 1 }).base, 40000)
  assert.equal(
    resolveBase({ measure: 40000, scale: 'per_period', periodsPerYear: 4, monthsOpen: 0 }).base,
    10000,
  )
})

test('floor and cap bound the base after the abatement', () => {
  assert.equal(resolveBase({ measure: 1000, floor: 5000 }).base, 5000)
  assert.equal(resolveBase({ measure: 100000, cap: 48060 }).base, 48060)
})

test('a negative measure stays negative and takes no abatement', () => {
  const r = resolveBase({ measure: -3000, abatement: { rate: 34 } })
  assert.equal(r.base, -3000)
  assert.equal(r.abatement, 0)
})

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

test('a rate on the revenue: the micro-social contribution', () => {
  assert.equal(computeAmount({ form: 'rate', rate: 25.6 }, 5000).gross, 1280)
  assert.equal(round2(computeAmount({ form: 'rate', rate: 0.2 }, 5000).gross), 10)
  assert.equal(round2(computeAmount({ form: 'rate', rate: 2.2 }, 5000).gross), 110)
})

test('the RETA contribution is the chosen base, clamped to its row, at the global rate', () => {
  // A monthly yield of 2 500 falls in the row bounded 1 356.21 to 2 760.
  const chosen = electiveResolution(RETA, 2500, 1500)
  assert.deepEqual(
    [chosen.row.minBase, chosen.row.maxBase, chosen.appliedBase, chosen.assumed],
    [1356.21, 2760, 1500, false],
  )
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 1500 }, 2500).gross),
    472.5,
  )
  // Chosen below the row: raised to its minimum.
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 1000 }, 2500).gross),
    427.21,
  )
  // Chosen above the row: capped at its maximum.
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 3000 }, 2500).gross),
    869.4,
  )
  // Nothing chosen: the minimum stands in, and the result says so.
  const assumed = computeAmount({ form: 'elective_base', elective: RETA, chosenBase: null }, 2500)
  assert.equal(assumed.elective?.assumed, true)
  assert.equal(round2(assumed.gross), 427.21)
})

test('a rule that settles later provisions the chosen base as declared, bounded by nothing', () => {
  // The row the reference names is still known (the screen says which), but a
  // rule whose year is settled afterwards pays the choice itself every period:
  // bounding it here and billing the gap again at year end would count twice.
  const low = electiveResolution(RETA, 2500, 1000, true)
  assert.deepEqual([low.row.minBase, low.appliedBase], [1356.21, 1000])
  assert.equal(
    round2(
      computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 1000, settledLater: true }, 2500)
        .gross,
    ),
    315,
  )
  // Above the row's maximum too: the provision is what leaves the account.
  assert.equal(electiveResolution(RETA, 2500, 6000, true).appliedBase, 6000)
  // Nothing chosen: the row's minimum stands in either way, since there is no
  // figure to pay, and the result still says the base was assumed.
  const assumed = electiveResolution(RETA, 2500, null, true)
  assert.deepEqual([assumed.appliedBase, assumed.assumed], [1356.21, true])
  // Without a regularisation the row is the only protection left, so it holds.
  assert.equal(electiveResolution(RETA, 2500, 1000).appliedBase, 1356.21)
})

test('what a settling rule provisions plus what it regularises is the definitive amount, once', () => {
  // Twelve months at a base chosen below the row the closed year names.
  const provisioned =
    12 *
    computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 1000, settledLater: true }, 2500).gross
  const settled = 12 * deadzoneAdjustment(RETA, 2500, 1000).amount
  const definitive = 12 * 1356.21 * 0.315
  assert.equal(round2(provisioned + settled), round2(definitive))
  // The old reading bounded the provision to the row as well, so the year came
  // to the definitive amount plus that same gap a second time.
  assert.equal(
    round2(
      12 * computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 1000 }, 2500).gross + settled,
    ),
    round2(definitive + settled),
  )
})

test('the RETA rows reproduce the published monthly contributions at their minimum and maximum bases', () => {
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 653.59 }, 600).gross),
    205.88,
  )
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 950.98 }, 1200).gross),
    299.56,
  )
  assert.equal(
    round2(computeAmount({ form: 'elective_base', elective: RETA, chosenBase: 5101.2 }, 7000).gross),
    1606.88,
  )
  // 1 166.70 belongs to the first general row, not to the last reduced one.
  assert.equal(electiveResolution(RETA, 1166.7, null).row.minBase, 950.98)
  assert.equal(electiveResolution(RETA, 1166.69, null).row.minBase, 849.67)
})

test('a fixed amount and no amount', () => {
  assert.equal(computeAmount({ form: 'fixed', amount: 800 }, 0).gross, 800)
  assert.equal(computeAmount({ form: 'none' }, 123456).gross, 0)
})

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

test('the foral quarterly instalment is a rate on the quarter profit less the quarter withholdings', () => {
  const r = evaluateLevy({
    base: { measure: 12000 },
    amount: { form: 'rate', rate: 20 },
    credits: [{ source: 'withholdings', value: 1050, share: 100 }],
  })
  assert.equal(r.gross, 2400)
  assert.equal(r.credits, 1050)
  assert.equal(r.net, 1350)
})

test('from the third year the instalment reads two years back and credits a quarter of those withholdings', () => {
  const r = evaluateLevy({
    base: { measure: 40000 },
    amount: { form: 'rate', rate: 5 },
    credits: [{ source: 'withholdings', value: 2800, share: 25 }],
  })
  assert.equal(r.net, 1300)
})

test('more credited than owed leaves a signed negative net, the refund', () => {
  assert.equal(applyCredits(500, [{ source: 'withholdings', value: 800, share: 100 }], null, null).net, -300)
})

test('the annual foral income tax: abatement by last year, start reduction, schedule, credits after the amount', () => {
  const r = evaluateLevy({
    base: { measure: 50000, abatement: FORAL_ABATEMENT, abatementReference: 30000 },
    amount: { form: 'brackets', brackets: FORAL_SCHEDULE },
    modifiers: effectsOf([
      {
        effect: 'coefficient',
        value: 0.9,
        startsOn: null,
        durationMonths: null,
        durationPeriods: null,
        endsOn: null,
      },
    ]),
    fixedCredit: 1615,
    inputCredit: 682,
    credits: [
      { source: 'withholdings', value: 4200, share: 100 },
      { source: 'paid', value: 1350, share: 100 },
    ],
  })
  assert.equal(round2(r.base.base), 36000)
  assert.equal(round2(r.gross), 9176)
  assert.equal(round2(r.credits), 1615 + 682 + 4200 + 1350)
  assert.equal(round2(r.net), 1329)
})

test('VAT: the balance of collected and deductible at a full rate, a pass-through with nothing else', () => {
  const r = evaluateLevy({ base: { measure: 6300 - 1200 }, amount: { form: 'rate', rate: 100 } })
  assert.equal(r.net, 5100)
})

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

const quarterly = (from: string, to: string, index: number, fiscalYear: number) =>
  ({ fiscalYear, unit: 'quarter', index, from, to }) as const

test('a modifier starting with the activity and lasting some periods ends with the last of them', () => {
  // ACRE: a reduced rate until the end of the third civil quarter after the one the activity started in.
  const acre = {
    effect: 'rate_factor' as const,
    value: 0.75,
    startsOn: null,
    durationMonths: null,
    durationPeriods: 4,
    endsOn: null,
  }
  assert.deepEqual(modifierRange(acre, '2026-05-15', 'quarter', CIVIL), {
    from: '2026-05-15',
    to: '2027-03-31',
  })
  const active = modifiersFor([acre], quarterly('2026-04-01', '2026-06-30', 2, 2026), '2026-05-15', CIVIL)
  assert.equal(active.length, 1)
  assert.equal(
    modifiersFor([acre], quarterly('2027-01-01', '2027-03-31', 1, 2027), '2026-05-15', CIVIL).length,
    1,
  )
  assert.equal(
    modifiersFor([acre], quarterly('2027-04-01', '2027-06-30', 2, 2027), '2026-05-15', CIVIL).length,
    0,
  )
  // Without a start of any kind, the modifier never applies.
  assert.equal(modifierRange(acre, null, 'quarter', CIVIL), null)
})

test('a modifier lasting months ends the day before the same day n months later', () => {
  const flat = {
    effect: 'replace_amount' as const,
    value: 80,
    startsOn: '2027-01-01',
    durationMonths: 12,
    durationPeriods: null,
    endsOn: null,
  }
  assert.deepEqual(modifierRange(flat, null, 'month', CIVIL), { from: '2027-01-01', to: '2027-12-31' })
  const months = periodsOf(2027, CIVIL, 'month')
  assert.equal(modifiersFor([flat], months[0]!, null, CIVIL).length, 1)
  assert.equal(modifiersFor([flat], months[11]!, null, CIVIL).length, 1)
  assert.equal(modifiersFor([flat], periodsOf(2028, CIVIL, 'month')[0]!, null, CIVIL).length, 0)
})

test('a dated end and an open end', () => {
  const dated = {
    effect: 'exempt' as const,
    value: null,
    startsOn: '2026-01-01',
    durationMonths: null,
    durationPeriods: null,
    endsOn: '2026-12-31',
  }
  assert.deepEqual(modifierRange(dated, null, 'year', CIVIL), { from: '2026-01-01', to: '2026-12-31' })
  const open = { ...dated, endsOn: null }
  assert.deepEqual(modifierRange(open, null, 'year', CIVIL), { from: '2026-01-01', to: null })
  assert.equal(modifiersFor([open], periodsOf(2030, CIVIL, 'year')[0]!, null, CIVIL).length, 1)
})

test('ACRE multiplies the contribution rate by three quarters', () => {
  const r = evaluateLevy({
    base: { measure: 5000 },
    amount: { form: 'rate', rate: 25.6 },
    modifiers: effectsOf([
      {
        effect: 'rate_factor',
        value: 0.75,
        startsOn: null,
        durationMonths: null,
        durationPeriods: null,
        endsOn: null,
      },
    ]),
  })
  assert.equal(r.gross, 960)
})

test('a flat amount replaces the computed contribution, an exemption zeroes it', () => {
  const replaced = evaluateLevy({
    base: { measure: 30000, coefficient: 0.93, scale: 'per_month', monthsOpen: 12 },
    amount: { form: 'elective_base', elective: RETA, chosenBase: 960.78 },
    modifiers: effectsOf([
      {
        effect: 'replace_amount',
        value: 80,
        startsOn: null,
        durationMonths: null,
        durationPeriods: null,
        endsOn: null,
      },
    ]),
  })
  assert.equal(replaced.gross, 80)
  assert.equal(replaced.replaced, true)
  const exempt = evaluateLevy({
    base: { measure: 0 },
    amount: { form: 'fixed', amount: 800 },
    modifiers: effectsOf([
      {
        effect: 'exempt',
        value: null,
        startsOn: null,
        durationMonths: null,
        durationPeriods: null,
        endsOn: null,
      },
    ]),
  })
  assert.equal(exempt.net, 0)
  assert.equal(exempt.exempt, true)
})

// ---------------------------------------------------------------------------
// Regularisation
// ---------------------------------------------------------------------------

test('the dead zone: nothing within the definitive row, the gap to the nearest bound outside it', () => {
  assert.equal(deadzoneAdjustment(RETA, 2500, 1500).amount, 0)
  assert.equal(round2(deadzoneAdjustment(RETA, 2500, 1000).amount), 112.21)
  assert.equal(round2(deadzoneAdjustment(RETA, 2500, 3000).amount), -75.6)
  // Twelve months at the same chosen base: the yearly regularisation.
  assert.equal(round2(12 * deadzoneAdjustment(RETA, 2500, 1000).amount), 1346.47)
})

test('a provisional year settles for the difference with the definitive amount', () => {
  assert.equal(settlementDifference(4800, 3600), 1200)
  assert.equal(settlementDifference(3000, 3600), -600)
})

test('a regularisation falls due in the month a number of months after the year closed', () => {
  assert.deepEqual(regularizationWindow('2027-12-31', 12), { from: '2028-12-01', to: '2028-12-31' })
  assert.deepEqual(regularizationWindow('2027-12-31', 16), { from: '2029-04-01', to: '2029-04-30' })
})

// ---------------------------------------------------------------------------
// Due windows
// ---------------------------------------------------------------------------

test('after the period: the 1st to the 25th of the month after a quarter', () => {
  const due: Due = { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 25 }
  const [q1] = dueWindows(periodsOf(2027, CIVIL, 'quarter')[0]!, due, CIVIL)
  assert.deepEqual(q1!.declaration, { from: '2027-04-01', to: '2027-04-25' })
  assert.deepEqual(q1!.payment, q1!.declaration)
  assert.equal(q1!.absorbed, false)
  const [q4] = dueWindows(periodsOf(2027, CIVIL, 'quarter')[3]!, due, CIVIL, {
    skipPeriods: { quarter: [4] },
  })
  assert.deepEqual(q4!.declaration, { from: '2028-01-01', to: '2028-01-25' })
  assert.equal(q4!.absorbed, true)
})

test('the end of the next month, and a day the month does not have', () => {
  const [w] = dueWindows(periodsOf(2026, CIVIL, 'month')[0]!, { type: 'end_of_next_month' }, CIVIL)
  assert.deepEqual(w!.declaration, { from: '2026-02-01', to: '2026-02-28' })
  const due: Due = { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 31 }
  assert.equal(dueWindows(periodsOf(2026, CIVIL, 'month')[0]!, due, CIVIL)[0]!.declaration.to, '2026-02-28')
})

test('fixed dates of the fiscal year: one deadline, one per period, or several instalments', () => {
  const annual: Due = { type: 'fixed_dates', dates: [{ month: 6, day: 30, yearOffset: 1 }] }
  const [renta] = dueWindows(periodsOf(2027, CIVIL, 'year')[0]!, annual, CIVIL)
  assert.deepEqual(renta!.declaration, { from: '2028-06-01', to: '2028-06-30' })
  const perQuarter: Due = {
    type: 'fixed_dates',
    dates: [
      { month: 4, day: 25, yearOffset: 0 },
      { month: 7, day: 25, yearOffset: 0 },
      { month: 10, day: 25, yearOffset: 0 },
      { month: 1, day: 25, yearOffset: 1 },
    ],
  }
  const quarters = periodsOf(2027, CIVIL, 'quarter')
  assert.equal(dueWindows(quarters[1]!, perQuarter, CIVIL)[0]!.declaration.to, '2027-07-25')
  assert.equal(dueWindows(quarters[3]!, perQuarter, CIVIL)[0]!.declaration.to, '2028-01-25')
  const twice: Due = {
    type: 'fixed_dates',
    dates: [
      { month: 6, day: 15, yearOffset: 0 },
      { month: 12, day: 15, yearOffset: 0 },
    ],
  }
  const instalments = dueWindows(periodsOf(2026, CIVIL, 'year')[0]!, twice, CIVIL)
  assert.equal(instalments.length, 2)
  assert.deepEqual([instalments[0]!.instalment, instalments[0]!.instalments], [1, 2])
  assert.equal(instalments[1]!.declaration.to, '2026-12-15')
})

test('a first return not before ninety days after the start folds the opening months into a later one', () => {
  const due: Due = { type: 'end_of_next_month' }
  const months = periodsOf(2026, CIVIL, 'month')
  const opts = { firstDueAfterDays: 90, activityStartedOn: '2026-05-15' }
  // May and June would be due in June and July, both before 13 August: they wait for July's return.
  assert.deepEqual(dueWindows(months[4]!, due, CIVIL, opts)[0]!.declaration, {
    from: '2026-08-01',
    to: '2026-08-31',
  })
  assert.deepEqual(dueWindows(months[5]!, due, CIVIL, opts)[0]!.declaration, {
    from: '2026-08-01',
    to: '2026-08-31',
  })
  assert.deepEqual(dueWindows(months[6]!, due, CIVIL, opts)[0]!.declaration, {
    from: '2026-08-01',
    to: '2026-08-31',
  })
  assert.deepEqual(dueWindows(months[7]!, due, CIVIL, opts)[0]!.declaration, {
    from: '2026-09-01',
    to: '2026-09-30',
  })
})

test('a payment lag moves the money, not the return', () => {
  const due: Due = { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 20 }
  const [w] = dueWindows(periodsOf(2026, CIVIL, 'quarter')[0]!, due, CIVIL, { declarationLagMonths: 1 })
  assert.deepEqual(w!.declaration, { from: '2026-04-01', to: '2026-04-20' })
  assert.deepEqual(w!.payment, { from: '2026-05-01', to: '2026-05-20' })
})

test('a window widened by fifteen days on both sides', () => {
  assert.deepEqual(widened({ from: '2027-04-01', to: '2027-04-25' }, 15), {
    from: '2027-03-17',
    to: '2027-05-10',
  })
})

// ---------------------------------------------------------------------------
// Accrual
// ---------------------------------------------------------------------------

test('a yearly amount accrues pro rata of the months elapsed', () => {
  assert.equal(proratedAnnual(1200, 5), 500)
  assert.equal(proratedAnnual(1200, 12), 1200)
  assert.equal(proratedAnnual(1200, 15), 1200)
  assert.equal(proratedAnnual(1200, 0), 0)
})
