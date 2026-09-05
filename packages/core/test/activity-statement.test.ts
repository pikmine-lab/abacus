import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import type { Levy } from '../src/domain/types.ts'
import { createAccount } from '../src/services/accounts.ts'
import { activityStatement, confirmLevyPayment } from '../src/services/activityStatement.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, createCategory } from '../src/services/catalog.ts'
import { declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/**
 * Two regimes written entirely as data, and the figures they produce. Not one
 * rate, table or country below exists anywhere in the code: they are read from
 * the rows these tests insert, exactly as a user or the MCP would write them.
 *
 * Rules and their parameters are inserted by SQL on purpose: writing them is
 * another slice's job, and this one only reads.
 */

interface ActivityRegime {
  kind?: 'business' | 'personal'
  startedOn?: string
  revenueBasis?: 'cash' | 'invoiced'
  vatRegistered?: boolean
  deductibleExpenses?: 'all' | 'none'
  regimeLabel?: string
}

async function businessActivity(userId: string, name: string, regime: ActivityRegime = {}): Promise<string> {
  const activity = await createActivity(userId, { name })
  await db()`
    update activity set
      kind = ${regime.kind ?? 'business'},
      started_on = ${regime.startedOn ?? null},
      revenue_basis = ${regime.revenueBasis ?? 'cash'},
      vat_registered = ${regime.vatRegistered ?? false},
      deductible_expenses = ${regime.deductibleExpenses ?? 'none'},
      regime_label = ${regime.regimeLabel ?? null}
    where id = ${activity.id}
  `
  return activity.id
}

async function activityAccount(userId: string, name: string, activityId: string): Promise<string> {
  const account = await createAccount({ userId, name, behavior: 'payment' })
  await db()`update account set activity_id = ${activityId} where id = ${account.id}`
  return account.id
}

/** What the driver accepts as a jsonb value, without restating its shape here. */
type Json = Parameters<ReturnType<typeof db>['json']>[0]

interface LevyRow {
  name: string
  kind: 'social' | 'income_tax' | 'vat' | 'other'
  validFrom: string
  validTo?: string
  baseMeasure: 'revenue' | 'profit' | 'vat_balance' | 'none' | 'input' | 'withholdings'
  basePeriodRef?: 'current' | 'ytd' | 'year' | 'year-1' | 'year-2' | 'rolling-12'
  baseCoefficient?: number
  baseAbatement?: Json
  baseAddBackLevyIds?: string[]
  baseCredits?: Json
  baseScale?: 'none' | 'per_month' | 'per_period' | 'annualized'
  amountForm: 'rate' | 'brackets' | 'elective_base' | 'fixed' | 'none'
  rate?: number
  brackets?: Json
  elective?: Json
  fixedAmount?: number
  fixedCredit?: number
  period: 'month' | 'quarter' | 'half' | 'year'
  due: Json
  skipPeriods?: Json
  regularization?: 'none' | 'annual_deadzone' | 'provisional_then_settled'
  settlementCategoryId?: string
  deductible?: boolean
  passThrough?: boolean
  status?: 'confirmed' | 'extended_by_default' | 'unconfirmed'
  reviewOn?: string
}

async function insertLevy(userId: string, activityId: string, row: LevyRow): Promise<Levy> {
  const sql = db()
  const [levy] = await sql<Levy[]>`
    insert into levy (
      user_id, activity_id, name, kind, valid_from, valid_to, status, review_on,
      base_measure, base_period_ref, base_coefficient, base_abatement, base_add_back_levy_ids,
      base_credits, base_scale,
      amount_form, rate, brackets, elective, fixed_amount, fixed_credit,
      period, due, skip_periods, regularization,
      settlement_category_id, deductible, pass_through
    ) values (
      ${userId}, ${activityId}, ${row.name}, ${row.kind}, ${row.validFrom}, ${row.validTo ?? null},
      ${row.status ?? 'confirmed'}, ${row.reviewOn ?? null},
      ${row.baseMeasure}, ${row.basePeriodRef ?? 'current'}, ${row.baseCoefficient ?? null},
      ${row.baseAbatement ? sql.json(row.baseAbatement) : null},
      ${row.baseAddBackLevyIds ?? null},
      ${row.baseCredits ? sql.json(row.baseCredits) : null}, ${row.baseScale ?? 'none'},
      ${row.amountForm}, ${row.rate ?? null},
      ${row.brackets ? sql.json(row.brackets) : null}, ${row.elective ? sql.json(row.elective) : null},
      ${row.fixedAmount ?? null}, ${row.fixedCredit ?? null},
      ${row.period}, ${sql.json(row.due)}, ${row.skipPeriods ? sql.json(row.skipPeriods) : null},
      ${row.regularization ?? 'none'},
      ${row.settlementCategoryId ?? null}, ${row.deductible ?? false}, ${row.passThrough ?? false}
    ) returning *
  `
  return levy!
}

async function insertModifier(
  levyId: string,
  row: {
    label: string
    effect: 'rate_factor' | 'replace_amount' | 'coefficient' | 'exempt'
    value?: number
    startsOn?: string
    durationMonths?: number
    durationPeriods?: number
    endsOn?: string
  },
): Promise<void> {
  await db()`
    insert into levy_modifier (levy_id, label, effect, value, starts_on, duration_months, duration_periods, ends_on)
    values (${levyId}, ${row.label}, ${row.effect}, ${row.value ?? null}, ${row.startsOn ?? null},
            ${row.durationMonths ?? null}, ${row.durationPeriods ?? null}, ${row.endsOn ?? null})
  `
}

async function insertInput(
  userId: string,
  activityId: string,
  name: string,
  validFrom: string,
  value: number,
): Promise<void> {
  await db()`
    insert into activity_input (user_id, activity_id, name, valid_from, value)
    values (${userId}, ${activityId}, ${name}, ${validFrom}, ${value})
  `
}

async function insertInvoice(
  userId: string,
  activityId: string,
  actorId: string,
  row: { reference: string; issuedOn: string; base: number; vat: number; withholding: number },
): Promise<{ id: string; receivable: number }> {
  const [invoice] = await db()<{ id: string; receivableAmount: string }[]>`
    insert into invoice (user_id, activity_id, actor_id, reference, issued_on, base_amount,
                         vat_rate, vat_amount, withholding_rate, withholding_amount)
    values (${userId}, ${activityId}, ${actorId}, ${row.reference}, ${row.issuedOn}, ${row.base},
            21, ${row.vat}, 7, ${row.withholding})
    returning *
  `
  return { id: invoice!.id, receivable: Number(invoice!.receivableAmount) }
}

async function payInvoice(
  userId: string,
  invoiceId: string,
  amount: number,
  on: string,
  actorId: string,
  accountId: string,
): Promise<void> {
  const movement = await declareMovement(userId, {
    happenedOn: on,
    amount,
    sourceActorId: actorId,
    targetAccountId: accountId,
  })
  await db()`update movement set invoice_id = ${invoiceId} where id = ${movement.id}`
}

function levyNamed(statement: Awaited<ReturnType<typeof activityStatement>>, name: string) {
  const levy = statement.levies.find((l) => l.name === name)
  assert.ok(levy, `no rule named ${name}`)
  return levy
}

// ---------------------------------------------------------------------------
// A flat-rate regime: three rates on the receipts and one flat amount
// ---------------------------------------------------------------------------

async function flatRateRegime(userId: string) {
  const activityId = await businessActivity(userId, 'Freelance', {
    startedOn: '2026-01-01',
    revenueBasis: 'cash',
    deductibleExpenses: 'none',
    regimeLabel: 'Flat-rate',
  })
  const account = await activityAccount(userId, 'Pro', activityId)
  const personal = await createAccount({ userId, name: 'Personal', behavior: 'payment' })
  const client = await createActor(userId, { name: 'ACME', activityId })
  const office = await createActor(userId, { name: 'Supplier' })
  const collector = await createActor(userId, { name: 'Collector' })
  const social = await createCategory(userId, 'Social contributions')
  const training = await createCategory(userId, 'Training levy')
  const incomeTax = await createCategory(userId, 'Income tax')
  const localTax = await createCategory(userId, 'Local tax')
  const supplies = await createCategory(userId, 'Supplies')

  const contributions = await insertLevy(userId, activityId, {
    name: 'Contributions',
    kind: 'social',
    validFrom: '2026-01-01',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 25.6,
    period: 'quarter',
    due: { type: 'end_of_next_month' },
    settlementCategoryId: social.id,
    reviewOn: '2026-01-01',
  })
  // Asserted by the user, never checked here: a reduced rate for the first
  // four quarters of the activity.
  await insertModifier(contributions.id, {
    label: 'Start-of-activity reduction',
    effect: 'rate_factor',
    value: 0.75,
    durationPeriods: 4,
  })
  await insertLevy(userId, activityId, {
    name: 'Training levy',
    kind: 'other',
    validFrom: '2026-01-01',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 0.2,
    period: 'quarter',
    due: { type: 'end_of_next_month' },
    settlementCategoryId: training.id,
  })
  await insertLevy(userId, activityId, {
    name: 'Flat income tax',
    kind: 'income_tax',
    validFrom: '2026-01-01',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 2.2,
    period: 'quarter',
    due: { type: 'end_of_next_month' },
    settlementCategoryId: incomeTax.id,
  })
  await insertLevy(userId, activityId, {
    name: 'Local business tax',
    kind: 'other',
    validFrom: '2026-01-01',
    baseMeasure: 'none',
    amountForm: 'fixed',
    fixedAmount: 300,
    period: 'year',
    due: { type: 'fixed_dates', dates: [{ month: 12, day: 15, yearOffset: 0 }] },
    settlementCategoryId: localTax.id,
  })

  for (const [on, amount] of [
    ['2026-02-10', 5000],
    ['2026-03-20', 3000],
    ['2026-05-15', 4000],
    ['2026-07-10', 2000],
  ] as const) {
    await declareMovement(userId, {
      happenedOn: on,
      amount,
      sourceActorId: client.id,
      targetAccountId: account,
    })
  }
  await declareMovement(userId, {
    happenedOn: '2026-04-01',
    amount: 500,
    sourceAccountId: account,
    targetActorId: office.id,
    categoryId: supplies.id,
    activityId,
  })
  // The first quarter settled: 8000 x 25.6 % x 0.75.
  await declareMovement(userId, {
    happenedOn: '2026-04-20',
    amount: 1536,
    sourceAccountId: account,
    targetActorId: collector.id,
    categoryId: social.id,
    activityId,
  })
  // What the owner took out of the activity.
  await declareMovement(userId, {
    happenedOn: '2026-06-30',
    amount: 3000,
    sourceAccountId: account,
    targetAccountId: personal.id,
  })
  return { activityId, account, collector, social }
}

test('a flat-rate regime: rates on the receipts, a flat amount, and the reserve they build', async () => {
  const user = await seedUser()
  const { activityId } = await flatRateRegime(user)
  const statement = await activityStatement(user, activityId, 2026, '2026-08-15')

  assert.equal(statement.basis, 'cash')
  assert.equal(statement.totals.revenue, 14000)
  // The regime deducts nothing, so a real expense is not a charge of the year.
  assert.equal(statement.totals.expenses, 0)

  const contributions = levyNamed(statement, 'Contributions')
  // 8000 and 4000 in the closed quarters, 2000 so far in the running one, all
  // at three quarters of the rate.
  assert.equal(contributions.accrued, 2688)
  assert.equal(contributions.currentPeriod?.amount, 384)
  assert.equal(contributions.accrualMethod, 'prorated')
  assert.equal(contributions.paid, 1536)
  assert.equal(contributions.reserve, 1152)
  assert.equal(contributions.overpaid, 0)
  assert.equal(contributions.reviewDue, true)

  assert.equal(levyNamed(statement, 'Training levy').accrued, 28)
  assert.equal(levyNamed(statement, 'Flat income tax').accrued, 308)
  // A yearly flat amount accrues with the year: 227 of its 365 days are gone.
  assert.equal(levyNamed(statement, 'Local business tax').accrued, 186.58)

  assert.equal(statement.totals.provisions, 3210.58)
  assert.equal(statement.totals.net, 10789.42)
  assert.equal(statement.totals.paidToSelf, 3000)

  // 14000 in, 500 of supplies, 1536 of contributions, 3000 taken out.
  assert.equal(statement.payableToSelf.treasury, 8964)
  assert.equal(statement.reserve, 1674.58)
  assert.equal(statement.payableToSelf.amount, 7289.42)

  // A due date says what its whole period is heading for, where the accrual
  // says what has been lived through: the running quarter has 2000 in it at
  // half time, so it is heading for twice that. A quarter with nothing in it
  // yet estimates nothing rather than guessing.
  const contributionDates = statement.schedule.filter((e) => e.levyName === 'Contributions')
  assert.deepEqual(
    contributionDates.map((e) => [e.periodIndex, e.declaration.from, e.declaration.to, e.amount, e.status]),
    [
      [1, '2026-04-01', '2026-04-30', 1536, 'paid'],
      [2, '2026-07-01', '2026-07-31', 768, 'overdue'],
      [3, '2026-10-01', '2026-10-31', 768, 'upcoming'],
      [4, '2027-01-01', '2027-01-31', 0, 'upcoming'],
    ],
  )
  const local = statement.schedule.find((e) => e.levyName === 'Local business tax')
  assert.deepEqual(
    [local?.declaration.from, local?.declaration.to, local?.amount],
    ['2026-12-01', '2026-12-15', 300],
  )

  const july = statement.months.find((m) => m.month === '2026-07-01')
  assert.equal(july?.revenue, 2000)
  assert.equal(july?.running, false)
  assert.equal(statement.months.find((m) => m.month === '2026-08-01')?.running, true)
  assert.equal(statement.months.find((m) => m.month === '2026-06-01')?.paidToSelf, 3000)
  // Nothing has happened after the day read, and nothing is guessed there.
  assert.equal(statement.months.find((m) => m.month === '2026-11-01')?.revenue, 0)
  // The monthly lines carry the same provisions as the year, each rounded on
  // its own line: a quarter spread over three months cannot land on the cent.
  const spread = statement.months.reduce((sum, m) => sum + m.provisions, 0)
  assert.ok(Math.abs(spread - statement.totals.provisions) < 0.1, `${spread} against the year`)

  assert.deepEqual(
    statement.revenueByClient.map((r) => [r.label, r.amount]),
    [['ACME', 14000]],
  )
  const settled = statement.expensesByCategory.find((c) => c.label === 'Social contributions')
  assert.equal(settled?.settlesLevy, true)
  assert.equal(statement.expensesByCategory.find((c) => c.label === 'Supplies')?.settlesLevy, false)
})

test('paying a due date writes the settlement and drops the reserve', async () => {
  const user = await seedUser()
  const { activityId, account, collector } = await flatRateRegime(user)
  const before = await activityStatement(user, activityId, 2026, '2026-08-15')
  const contributions = levyNamed(before, 'Contributions')
  const owed = before.schedule.find((e) => e.levyName === 'Contributions' && e.periodIndex === 2)!

  const movement = await confirmLevyPayment(user, {
    levyId: contributions.id,
    periodStart: owed.period.from,
    amount: owed.amount,
    date: '2026-07-15',
    accountId: account,
    actorId: collector.id,
  })
  assert.equal(movement.kind, 'expense')
  assert.equal(movement.activityId, activityId)
  assert.equal(movement.categoryId, contributions.settlementCategory?.id)

  const after = await activityStatement(user, activityId, 2026, '2026-08-15')
  const settled = levyNamed(after, 'Contributions')
  assert.equal(settled.paid, 2304)
  assert.equal(settled.reserve, 384)
  assert.equal(
    after.schedule.find((e) => e.levyName === 'Contributions' && e.periodIndex === 2)?.status,
    'paid',
  )
  // The money left the account, so what may be taken out falls with it.
  assert.equal(after.payableToSelf.treasury, 8196)
})

// ---------------------------------------------------------------------------
// A direct-assessment regime: a chosen base, a schedule, an allowance by step
// ---------------------------------------------------------------------------

const SCHEDULE = {
  mode: 'progressive',
  rows: [
    { upTo: 18080, rate: 23 },
    { upTo: 36160, rate: 28 },
    { upTo: 54240, rate: 35 },
    { upTo: 77450, rate: 40 },
    { upTo: null, rate: 45 },
  ],
}

const TRAMOS = {
  inputName: 'contribution_base',
  rate: 31.5,
  rows: [
    { upTo: 1300, minBase: 950.98, maxBase: 1300 },
    { upTo: 3620, minBase: 1519.61, maxBase: 3620 },
    { upTo: 6000, minBase: 1732.03, maxBase: 5101.2 },
    { upTo: null, minBase: 1928.1, maxBase: 5101.2 },
  ],
}

async function directAssessmentRegime(user: string) {
  const activityId = await businessActivity(user, 'Consulting', {
    startedOn: '2027-01-01',
    revenueBasis: 'invoiced',
    vatRegistered: true,
    deductibleExpenses: 'all',
    regimeLabel: 'Direct assessment',
  })
  const account = await activityAccount(user, 'Business', activityId)
  const client = await createActor(user, { name: 'Client SA', activityId })
  const supplier = await createActor(user, { name: 'Hosting' })
  const collector = await createActor(user, { name: 'Treasury' })
  const socialFund = await createCategory(user, 'Social security')
  const incomeTax = await createCategory(user, 'Income tax')
  const vat = await createCategory(user, 'VAT')
  const supplies = await createCategory(user, 'Supplies')

  const contribution = await insertLevy(user, activityId, {
    name: 'Social contribution',
    kind: 'social',
    validFrom: '2027-01-01',
    baseMeasure: 'profit',
    basePeriodRef: 'ytd',
    baseCoefficient: 0.93,
    baseScale: 'per_month',
    amountForm: 'elective_base',
    elective: TRAMOS,
    period: 'month',
    due: { type: 'end_of_next_month' },
    regularization: 'annual_deadzone',
    settlementCategoryId: socialFund.id,
    deductible: true,
    status: 'extended_by_default',
  })
  // The contributions themselves are back in the base they are computed on.
  await db()`update levy set base_add_back_levy_ids = ${[contribution.id]} where id = ${contribution.id}`
  await insertInput(user, activityId, 'contribution_base', '2027-01-01', 1800)

  await insertLevy(user, activityId, {
    name: 'Annual income tax',
    kind: 'income_tax',
    validFrom: '2027-01-01',
    baseMeasure: 'profit',
    basePeriodRef: 'ytd',
    baseAbatement: {
      brackets: [
        { upTo: 35000, rate: 20 },
        { upTo: 85000, rate: 15 },
        { upTo: null, rate: 10 },
      ],
      on: { measure: 'profit', periodRef: 'year-1' },
    },
    baseCredits: [{ source: 'withholdings', share: 100, periodRef: 'current' }],
    amountForm: 'brackets',
    brackets: SCHEDULE,
    fixedCredit: 1615,
    period: 'year',
    due: { type: 'fixed_dates', dates: [{ month: 6, day: 30, yearOffset: 1 }] },
    settlementCategoryId: incomeTax.id,
  })

  await insertLevy(user, activityId, {
    name: 'VAT',
    kind: 'vat',
    validFrom: '2027-01-01',
    baseMeasure: 'vat_balance',
    amountForm: 'rate',
    rate: 100,
    period: 'quarter',
    due: { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 25 },
    skipPeriods: { quarter: [4] },
    settlementCategoryId: vat.id,
    passThrough: true,
  })

  const invoices = []
  for (const [reference, issuedOn] of [
    ['2027-01', '2027-01-15'],
    ['2027-02', '2027-04-15'],
    ['2027-03', '2027-07-15'],
    ['2027-04', '2027-10-15'],
  ] as const) {
    invoices.push(
      await insertInvoice(user, activityId, client.id, {
        reference,
        issuedOn,
        base: 15000,
        vat: 3150,
        withholding: 1050,
      }),
    )
  }
  // Three invoices paid in full, the last one half paid: a receipt carries the
  // invoice's own split, pro rata of what it covers.
  await payInvoice(user, invoices[0]!.id, 17100, '2027-02-10', client.id, account)
  await payInvoice(user, invoices[1]!.id, 17100, '2027-05-10', client.id, account)
  await payInvoice(user, invoices[2]!.id, 17100, '2027-08-10', client.id, account)
  await payInvoice(user, invoices[3]!.id, 8550, '2027-11-10', client.id, account)

  const hosting = await declareMovement(user, {
    happenedOn: '2027-02-10',
    amount: 6050,
    sourceAccountId: account,
    targetActorId: supplier.id,
    categoryId: supplies.id,
    activityId,
  })
  // The VAT inside an expense is written by the slice that declares invoices;
  // here it is stated directly, since this one only reads it.
  await db()`update movement set vat_amount = 1050 where id = ${hosting.id}`
  // Twelve monthly contributions of 300, each debited at its month's end.
  for (let month = 1; month <= 12; month++) {
    const day = new Date(Date.UTC(2027, month, 0)).toISOString().slice(0, 10)
    await declareMovement(user, {
      happenedOn: day,
      amount: 300,
      sourceAccountId: account,
      targetActorId: collector.id,
      categoryId: socialFund.id,
      activityId,
    })
  }
  // The first three VAT returns settled, the fourth left unpaid.
  for (const [on, amount] of [
    ['2027-04-20', 2100],
    ['2027-07-20', 3150],
    ['2027-10-20', 3150],
  ] as const) {
    await declareMovement(user, {
      happenedOn: on,
      amount,
      sourceAccountId: account,
      targetActorId: collector.id,
      categoryId: vat.id,
      activityId,
    })
  }
  return { activityId, account, collector }
}

test('a direct-assessment regime: a chosen base, an allowance by step, a schedule and a VAT balance', async () => {
  const user = await seedUser()
  const { activityId } = await directAssessmentRegime(user)
  const statement = await activityStatement(user, activityId, 2027, '2028-03-01')

  assert.equal(statement.basis, 'invoiced')
  assert.equal(statement.asOf, '2027-12-31')
  assert.equal(statement.totals.revenue, 60000)
  // The other basis reads the same year through the bank: one invoice is only
  // half paid, so a quarter of the last invoice's base is missing there.
  assert.deepEqual(statement.totals.revenueOtherBasis, { basis: 'cash', revenue: 52500 })
  assert.equal(statement.totals.revenueInclVat, 72600)
  // 5000 of supplies before VAT, and the contributions, which this regime deducts.
  assert.equal(statement.totals.expenses, 8600)
  assert.equal(statement.totals.vatCollected, 12600)
  assert.equal(statement.totals.vatDeductible, 1050)
  assert.equal(statement.totals.withholdings, 4200)

  const contribution = levyNamed(statement, 'Social contribution')
  // The base is the year so far, contributions added back, read per month
  // open: it moves as the year fills in, and it names the row every month.
  // The rule settles at year end, so what it provisions is what really leaves
  // the account: the 1800 chosen, at 31.50 %, which is 567 every month. The
  // row is not applied here, or January (which reads its own receipts as the
  // pace of a whole year, and names a higher row) would already carry a bound
  // the regularisation is about to bill again.
  assert.equal(contribution.accrued, 6804)
  assert.equal(contribution.paid, 3600)
  assert.equal(contribution.reserve, 3204)
  assert.equal(contribution.accrualMethod, 'closed_periods')
  assert.equal(contribution.assumedElectiveBase, false)
  assert.equal(contribution.status, 'extended_by_default')

  // 51400 less a 20 % allowance (nothing was earned the year before, which is
  // the first step), through the schedule, less the flat credit and the
  // withholdings clients already paid.
  assert.equal(levyNamed(statement, 'Annual income tax').accrued, 5141.8)

  const vat = levyNamed(statement, 'VAT')
  assert.equal(vat.accrued, 11550)
  assert.equal(vat.paid, 8400)
  assert.equal(vat.reserve, 3150)
  assert.equal(vat.passThrough, true)

  // VAT is owed, so it stays in the reserve, and it is no charge, so it leaves
  // the net alone.
  assert.equal(statement.totals.provisions, 11945.8)
  assert.equal(statement.totals.provisionsPassThrough, 11550)
  // A month counts its provisions the way the year does, VAT apart: a column
  // that mixed the two would not add up to the total printed under it.
  const spreadCharges = statement.months.reduce((sum, m) => sum + m.provisions, 0)
  const spreadVat = statement.months.reduce((sum, m) => sum + m.provisionsPassThrough, 0)
  assert.ok(Math.abs(spreadCharges - statement.totals.provisions) < 0.1, `${spreadCharges} against the year`)
  assert.ok(
    Math.abs(spreadVat - statement.totals.provisionsPassThrough) < 0.1,
    `${spreadVat} against the year`,
  )
  assert.equal(statement.totals.net, 39454.2)
  assert.equal(statement.reserve, 11495.8)
  assert.equal(statement.payableToSelf.treasury, 41800)
  assert.equal(statement.payableToSelf.amount, 30304.2)

  const vatDates = statement.schedule.filter((e) => e.levyName === 'VAT')
  assert.deepEqual(
    vatDates.map((e) => [
      e.periodIndex,
      e.declaration.from,
      e.declaration.to,
      e.amount,
      e.status,
      e.absorbed,
    ]),
    [
      [1, '2027-04-01', '2027-04-25', 2100, 'paid', false],
      [2, '2027-07-01', '2027-07-25', 3150, 'paid', false],
      [3, '2027-10-01', '2027-10-25', 3150, 'paid', false],
      [4, '2028-01-01', '2028-01-25', 3150, 'overdue', true],
    ],
  )
  // Each month is settled by the debit at its own end, inside the window
  // widened by a fortnight on both sides.
  const monthly = statement.schedule.filter((e) => e.levyName === 'Social contribution')
  assert.equal(monthly.length, 12)
  assert.deepEqual(
    monthly.slice(0, 2).map((e) => [e.declaration.from, e.declaration.to, e.amount, e.status, e.paidOn]),
    [
      ['2027-02-01', '2027-02-28', 567, 'paid', '2027-01-31'],
      ['2027-03-01', '2027-03-31', 567, 'paid', '2027-02-28'],
    ],
  )

  const tax = statement.schedule.find((e) => e.levyName === 'Annual income tax')
  assert.deepEqual(
    [tax?.declaration.from, tax?.declaration.to, tax?.amount, tax?.status],
    ['2028-06-01', '2028-06-30', 5141.8, 'upcoming'],
  )
  // The chosen base sits inside the row the closed year names, so the yearly
  // regularisation owes nothing and no date appears for it.
  assert.equal(
    statement.schedule.some((e) => e.entry === 'regularization'),
    false,
  )

  const january = statement.months.find((m) => m.month === '2027-01-01')
  assert.equal(january?.revenue, 15000)
  assert.equal(statement.months.find((m) => m.month === '2027-02-01')?.revenue, 0)
  assert.equal(statement.months.find((m) => m.month === '2027-02-01')?.expenses, 5300)
  assert.equal(statement.months.length, 12)

  assert.deepEqual(
    statement.revenueByClient.map((r) => [r.label, r.amount]),
    [['Client SA', 60000]],
  )
})

test('an activity that is only an analysis dimension has no statement', async () => {
  const user = await seedUser()
  const activityId = await businessActivity(user, 'Household', { kind: 'personal' })
  // The same refusal as everywhere else in the domain, under the same code.
  await assert.rejects(
    () => activityStatement(user, activityId, 2027, '2027-06-01'),
    (e: DomainError) => e.code === 'activity_not_business',
  )
})

test('a provisional rule settles the year it ran ahead of, as a dated entry of the year after', async () => {
  const user = await seedUser()
  const activityId = await businessActivity(user, 'Practice', {
    startedOn: '2026-01-01',
    revenueBasis: 'cash',
    deductibleExpenses: 'none',
  })
  const account = await activityAccount(user, 'Pro', activityId)
  const client = await createActor(user, { name: 'Client', activityId })
  const fund = await createCategory(user, 'Contributions')
  await insertLevy(user, activityId, {
    name: 'Provisional contribution',
    kind: 'social',
    validFrom: '2026-01-01',
    // Each month runs on the year before, spread over its months; the closed
    // year is what the settlement is finally computed on.
    baseMeasure: 'profit',
    basePeriodRef: 'year-1',
    baseScale: 'per_month',
    amountForm: 'rate',
    rate: 20,
    period: 'month',
    due: { type: 'end_of_next_month' },
    regularization: 'provisional_then_settled',
    settlementCategoryId: fund.id,
  })
  await db()`
    update levy set regularization_params = ${db().json({ settleMonthOffset: 6 })}
    where activity_id = ${activityId}
  `
  await declareMovement(user, {
    happenedOn: '2026-06-15',
    amount: 24000,
    sourceActorId: client.id,
    targetAccountId: account,
  })
  await declareMovement(user, {
    happenedOn: '2027-06-15',
    amount: 36000,
    sourceActorId: client.id,
    targetAccountId: account,
  })

  const statement = await activityStatement(user, activityId, 2027, '2028-03-01')
  // 24000 earned in 2026, read per month, at 20 %: 400 a month through 2027.
  assert.equal(levyNamed(statement, 'Provisional contribution').accrued, 4800)
  // Two settlements are in sight: the one for 2026, which falls due inside
  // 2027 and is what the year has to pay, and the one 2027 is building, which
  // falls due the year after. 2026 ran on nothing (no year before it) and
  // really made 24000, so it owes 400 a month; 2027 ran on those 24000 and
  // really made 36000, so it owes the 200 a month it was short of.
  assert.deepEqual(
    statement.schedule
      .filter((e) => e.entry === 'regularization')
      .map((e) => [e.forFiscalYear, e.amount, e.declaration.from, e.status]),
    [
      [2026, 4800, '2027-06-01', 'overdue'],
      [2027, 2400, '2028-06-01', 'upcoming'],
    ],
  )
})

// ---------------------------------------------------------------------------
// What the year provisions and what its closure settles, told apart
// ---------------------------------------------------------------------------

/** A chosen base within a two-row table, whose bounds only the year end reads. */
const BOUNDS = {
  inputName: 'chosen_base',
  rate: 30,
  rows: [
    { upTo: 1000, minBase: 500, maxBase: 1000 },
    { upTo: null, minBase: 1200, maxBase: 3000 },
  ],
}

test('a settling rule provisions the base as declared, and the closed year bills the gap once', async () => {
  const user = await seedUser()
  const activityId = await businessActivity(user, 'Practice', {
    startedOn: '2027-01-01',
    revenueBasis: 'cash',
    deductibleExpenses: 'none',
  })
  const account = await activityAccount(user, 'Pro', activityId)
  const client = await createActor(user, { name: 'Client', activityId })
  const fund = await createCategory(user, 'Contributions')
  await insertLevy(user, activityId, {
    name: 'Chosen contribution',
    kind: 'social',
    validFrom: '2027-01-01',
    baseMeasure: 'revenue',
    // The whole fiscal year, so every month reads the same window and names
    // the same row; the year to date would name a different one each month.
    basePeriodRef: 'year',
    baseScale: 'per_month',
    amountForm: 'elective_base',
    elective: BOUNDS,
    period: 'month',
    due: { type: 'end_of_next_month' },
    regularization: 'annual_deadzone',
    settlementCategoryId: fund.id,
  })
  await insertInput(user, activityId, 'chosen_base', '2027-01-01', 800)
  for (const on of ['2027-03-20', '2027-09-20'])
    await declareMovement(user, {
      happenedOn: on,
      amount: 18000,
      sourceActorId: client.id,
      targetAccountId: account,
    })

  const statement = await activityStatement(user, activityId, 2027, '2028-03-01')
  // 36000 read over the twelve months open is 3000 a month, which names the
  // open row and its minimum of 1200. What is paid every month is the 800
  // chosen, at 30 %: the same 240 twelve times, none of them bounded.
  const monthly = statement.schedule.filter((e) => e.entry === 'period')
  assert.equal(monthly.length, 12)
  assert.deepEqual([...new Set(monthly.map((e) => e.amount))], [240])
  assert.equal(levyNamed(statement, 'Chosen contribution').accrued, 2880)
  // The closure confronts that choice with the definitive row, and owes the
  // whole gap to its minimum: twelve months of 400 at 30 %.
  const settlement = statement.schedule.find((e) => e.entry === 'regularization')
  assert.deepEqual(
    [settlement?.forFiscalYear, settlement?.amount, settlement?.declaration.from],
    [2027, 1440, '2028-12-01'],
  )
  // Together they are what the year really cost, and nothing more: twelve
  // months at the row's minimum. Bounding the provision as well would bill
  // that same gap a second time.
  assert.equal(2880 + 1440, (12 * 1200 * 30) / 100)
})

test('a quarterly instalment on a yearly measure takes its quarter, the rate staying the rate', async () => {
  const user = await seedUser()
  const activityId = await businessActivity(user, 'Studio', {
    startedOn: '2026-01-01',
    revenueBasis: 'cash',
    deductibleExpenses: 'none',
  })
  const account = await activityAccount(user, 'Pro', activityId)
  const client = await createActor(user, { name: 'Client', activityId })
  const collector = await createCategory(user, 'Instalments')
  await insertLevy(user, activityId, {
    name: 'Instalment',
    kind: 'income_tax',
    validFrom: '2027-01-01',
    baseMeasure: 'revenue',
    basePeriodRef: 'year-1',
    baseScale: 'per_period',
    amountForm: 'rate',
    rate: 20,
    period: 'quarter',
    due: { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 25 },
    settlementCategoryId: collector.id,
  })
  await declareMovement(user, {
    happenedOn: '2026-05-20',
    amount: 40000,
    sourceActorId: client.id,
    targetAccountId: account,
  })

  const statement = await activityStatement(user, activityId, 2027, '2028-03-01')
  // 40000 the year before, a quarter of it each quarter, at the 20 % the text
  // fixes: no rule of three folded into the rate.
  assert.deepEqual(
    statement.schedule.filter((e) => e.entry === 'period').map((e) => e.amount),
    [2000, 2000, 2000, 2000],
  )
  assert.equal(levyNamed(statement, 'Instalment').accrued, 8000)
})
