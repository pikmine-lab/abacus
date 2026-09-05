import type { LevyModifier, Threshold } from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import {
  abatementSchema,
  bracketsSchema,
  dueSchema,
  electiveSchema,
  regularizationParamsSchema,
  skipPeriodsSchema,
} from '@abacus/core/domain/levy'
import { today } from '@abacus/core/domain/period'
import { listCategories } from '@abacus/core/services/catalog'
import {
  addModifier,
  closeLevy,
  createLevy,
  createThreshold,
  deleteLevy,
  editLevy,
  editThreshold,
  type LevyEdit,
  type LevyWithModifiers,
  listInputs,
  listLevies,
  listThresholds,
  removeInput,
  removeModifier,
  removeThreshold,
  setInput,
  supersedeLevy,
} from '@abacus/core/services/levies'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireActivityByName, requireCategoryByName } from '../resolve.ts'
import { clearable, fail, isoDate, ok, run } from './shared.ts'

/**
 * The regime of a business activity, configured as data by an AI that has
 * read the official texts. These descriptions are the whole grammar that AI
 * sees: they teach the seven blocks of a rule, what each form means, and the
 * one discipline that keeps the ledger honest: a value is never stated from
 * memory, and a value that changes is a new dated row.
 */

const STATUS = z
  .enum(['confirmed', 'extended_by_default', 'unconfirmed'])
  .describe(
    'confirmed: a text in force fixes the value. extended_by_default: the text lapsed and the administration keeps applying it (say so, the user sees it). unconfirmed: no text fixes the value yet, e.g. a rate announced but not published; sourceUrl may then be omitted, and the figure shows as unconfirmed',
  )

const PERIOD_REF = z
  .enum(['current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12'])
  .describe(
    'current: the period itself. ytd: the fiscal year up to the period read, so it grows period after period. year: the whole fiscal year of the period, the same window for every period of it, which is what a monthly rule assessed on a yearly figure reads. year-1 / year-2: the previous fiscal year, or the one before. rolling-12: the last twelve months',
  )

/** Credits name rules by name here; the service wants their ids. */
const creditInput = z.object({
  source: z
    .enum(['withholdings', 'paid', 'amount'])
    .describe(
      'withholdings: what clients kept back at source. paid: the settlements of another rule (instalments against the annual tax). amount: the computed amount of another rule',
    ),
  levy: z.string().optional().describe('paid/amount: the rule read, by name'),
  share: z.number().min(0).max(100).optional().describe('Percentage credited, 100 by default'),
  periodRef: PERIOD_REF.optional().describe('Period the credit is read over, current by default'),
})

/** The rules of one activity, by name or id: the vocabulary the AI sees. */
async function requireLevy(userId: string, activityId: string, ref: string): Promise<LevyWithModifiers> {
  const levies = await listLevies(userId, activityId)
  const byId = levies.find((levy) => levy.id === ref)
  if (byId) return byId
  const wanted = ref.trim().toLowerCase()
  const named = levies.filter((levy) => levy.name.toLowerCase() === wanted)
  if (named.length === 1) return named[0]!
  if (named.length === 0)
    throw new DomainError(
      'levy_not_found',
      `No rule "${ref}" in this activity. Its rules: ${[...new Set(levies.map((l) => l.name))].join(', ') || 'none'}.`,
    )
  // Several validities share the name: the one in force today is what a name
  // means, unless nothing or several are, and then the id decides.
  const now = today()
  const inForce = named.filter((l) => l.validFrom <= now && (l.validTo === null || l.validTo >= now))
  if (inForce.length === 1) return inForce[0]!
  throw new DomainError(
    'levy_ambiguous',
    `Several rows of "${ref}" exist, none or several in force today. Pass levyId: ${named
      .map((l) => `${l.validFrom} to ${l.validTo ?? 'open'} (${l.id})`)
      .join(', ')}.`,
  )
}

function view(levy: LevyWithModifiers, names: Map<string, string>, categories: Map<string, string>) {
  const num = (v: string | null) => (v === null ? undefined : Number(v))
  const credits = levy.baseCredits as
    | { source: string; levyId?: string; share: number; periodRef: string }[]
    | null
  return {
    levyId: levy.id,
    name: levy.name,
    kind: levy.kind,
    validFrom: levy.validFrom,
    validTo: levy.validTo ?? undefined,
    status: levy.status,
    sourceUrl: levy.sourceUrl ?? undefined,
    verifiedOn: levy.verifiedOn ?? undefined,
    reviewOn: levy.reviewOn ?? undefined,
    base: {
      measure: levy.baseMeasure,
      levy: levy.baseLevyId ? names.get(levy.baseLevyId) : undefined,
      inputName: levy.baseInputName ?? undefined,
      periodRef: levy.basePeriodRef,
      coefficient: num(levy.baseCoefficient),
      addBackLevies: levy.baseAddBackLevyIds?.map((id) => names.get(id) ?? id),
      abatement: levy.baseAbatement ?? undefined,
      floor: num(levy.baseFloor),
      cap: num(levy.baseCap),
      credits: credits?.map((c) => ({
        ...c,
        levyId: undefined,
        levy: c.levyId ? names.get(c.levyId) : undefined,
      })),
      scale: levy.baseScale,
    },
    amount: {
      form: levy.amountForm,
      rate: num(levy.rate),
      brackets: levy.brackets ?? undefined,
      elective: levy.elective ?? undefined,
      fixedAmount: num(levy.fixedAmount),
      fixedInputName: levy.fixedInputName ?? undefined,
      fixedCredit: num(levy.fixedCredit),
      creditInputName: levy.creditInputName ?? undefined,
    },
    schedule: {
      period: levy.period,
      due: levy.due,
      declarationLagMonths: levy.declarationLagMonths ?? undefined,
      firstDueAfterDays: levy.firstDueAfterDays ?? undefined,
      skipPeriods: levy.skipPeriods ?? undefined,
    },
    regularization: levy.regularization,
    regularizationParams: levy.regularizationParams ?? undefined,
    settlement: {
      category: levy.settlementCategoryId ? categories.get(levy.settlementCategoryId) : undefined,
      deductible: levy.deductible,
      passThrough: levy.passThrough,
    },
    note: levy.note ?? undefined,
    modifiers: levy.modifiers.map(modifierView),
  }
}

function modifierView(m: LevyModifier) {
  return {
    modifierId: m.id,
    label: m.label,
    effect: m.effect,
    value: m.value === null ? undefined : Number(m.value),
    startsOn: m.startsOn ?? 'the activity start',
    durationMonths: m.durationMonths ?? undefined,
    durationPeriods: m.durationPeriods ?? undefined,
    endsOn: m.endsOn ?? undefined,
    condition: m.condition ?? undefined,
    status: m.status,
    sourceUrl: m.sourceUrl ?? undefined,
    verifiedOn: m.verifiedOn ?? undefined,
  }
}

function thresholdView(t: Threshold) {
  return {
    thresholdId: t.id,
    label: t.label,
    measure: t.measure,
    periodRef: t.periodRef,
    comparison: t.comparison,
    value: Number(t.value),
    consequence: t.consequence,
    sourceUrl: t.sourceUrl ?? undefined,
    verifiedOn: t.verifiedOn ?? undefined,
    reviewOn: t.reviewOn ?? undefined,
  }
}

export function registerLevyTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_levies',
    {
      description:
        "Configures the regime of a business activity as dated, sourced rules: each rule is one thing the activity owes (a social contribution, an income tax or its instalments, a VAT return, a local tax). No rate, country or regime is built in: the regime IS the set of rules written here, and the engine computes provisions, reserves and due dates from them. Actions: list (the activity's rules with their modifiers; at narrows to those in force that day), create, update (correct a rule that was mistyped: same validity, the value that was meant all along), supersede (the rule changes from a date: the current row closes the day before validFrom and a new row starts, inheriting every field not passed, running modifiers included; a rate, a table or a bound that changes on a date is ALWAYS a supersede and never an update, so last year's statement keeps the row it was computed with), close (ends a rule on validTo, no successor), delete (only a rule never settled and read by no other rule; otherwise close it), add_modifier, remove_modifier. " +
        "A rule has seven blocks. 1 Identity: name, kind, validFrom, validTo, sourceUrl, verifiedOn, reviewOn, status. 2 Base: baseMeasure read over basePeriodRef, then in this order: x baseCoefficient, + the settlements of baseAddBackLevies, - baseAbatement, bounded by baseFloor and baseCap, - baseCredits, then baseScale. 3 Amount: amountForm rate (rate % of the base), brackets (a table read on the base: progressive taxes each slice at its own rate, step applies the single row the whole base falls in, and a step row may give an amount instead of a rate), elective_base (the user chooses a base within the bounds of the row their reference falls in, stored as the dated input named inputName, then taxed at rate), fixed (fixedAmount per period, or the dated input fixedInputName), none (a return with nothing to pay). After the amount: - fixedCredit, - the dated input creditInputName. 4 Schedule: period, due, declarationLagMonths, firstDueAfterDays, skipPeriods. 5 Regularization: none; annual_deadzone (at year end the definitive base names a row of the elective table; nothing is owed if the chosen base sits within its bounds, else the difference to the nearest bound, settled the next year, refunded the one after); provisional_then_settled (the periods ran on an older reference or a stated figure; the definitive amount is recomputed on the closed year and the difference is one dated instalment). 6 Modifiers: a temporary change whose eligibility the user asserts and the engine never checks. 7 Settlement: settlementCategory (the activity's expenses in this category pay the rule and settle its provision; they never add to the charges), deductible (paying it reduces the profit), passThrough (neither revenue nor charge: VAT collected for the state). " +
        'Generic example: "20% of the quarter\'s profit minus the quarter\'s withholdings, due the 25th of the month after" is baseMeasure profit, basePeriodRef current, baseCredits [{source: withholdings}], amountForm rate, rate 20, period quarter, due {type: after_period, toDay: 25}. "A flat amount per month for the first twelve months" is add_modifier with effect replace_amount, value, durationMonths 12. ' +
        "Sources: never state a rate, a threshold, a bound or a date from memory, and never from a secondary site when the official text is reachable. Read the text in force for the validity you write, pass its URL as sourceUrl and the day you read it as verifiedOn (both required on create and supersede, sourceUrl waived only for status unconfirmed), and set reviewOn to the day it may change (a yearly schedule: the next first day of the fiscal year). When several validities exist, write one row per validity with the right dates rather than the latest value alone. Rules of one activity may read each other (base, add-back, credits) but never another activity's. update/supersede/close/delete address the rule by levy (its name; when several validities share it, the one in force today), or by levyId from list.",
      inputSchema: z.object({
        action: z.enum([
          'list',
          'create',
          'update',
          'supersede',
          'close',
          'delete',
          'add_modifier',
          'remove_modifier',
        ]),
        activity: z.string().describe('The business activity, by name'),
        levy: z
          .string()
          .optional()
          .describe(
            'update/supersede/close/delete/add_modifier/remove_modifier: the rule, by name or levyId',
          ),
        at: isoDate.optional().describe('list: only the rules in force that day'),
        name: z.string().optional().describe('create: the name; update: the corrected name'),
        kind: z
          .enum(['social', 'income_tax', 'vat', 'other'])
          .optional()
          .describe(
            'What the rule is, for grouping: social contribution, income tax (or its instalments), VAT, other',
          ),
        validFrom: isoDate
          .optional()
          .describe(
            'create: first day the rule applies. supersede: first day of the new values (required). close: not used',
          ),
        validTo: isoDate
          .nullable()
          .optional()
          .describe(
            'create/update: last day the rule applies, null for open. close: the last day (required)',
          ),
        sourceUrl: z
          .string()
          .nullable()
          .optional()
          .describe(
            'URL of the official text fixing the values, as read. Required on create and supersede unless status is unconfirmed',
          ),
        verifiedOn: isoDate
          .optional()
          .describe('The day you read the text. Required on create and supersede'),
        reviewOn: isoDate
          .nullable()
          .optional()
          .describe(
            'The day to check the rule again (a yearly schedule: the next fiscal year start). The user is reminded past it',
          ),
        status: STATUS.optional(),
        baseMeasure: z
          .enum([
            'revenue',
            'revenue_incl_vat',
            'expenses',
            'profit',
            'vat_balance',
            'withholdings',
            'paid',
            'amount',
            'input',
            'none',
          ])
          .optional()
          .describe(
            'revenue: receipts excluding VAT (invoiced or cashed, as the activity states). revenue_incl_vat: with VAT. expenses: deductible expenses. profit: revenue minus expenses. vat_balance: VAT collected minus deductible. withholdings: what clients kept back. paid: the settlements of the rule baseLevy. amount: the computed amount of baseLevy. input: the dated figure baseInputName. none: no base (fixed or none forms)',
          ),
        baseLevy: z.string().optional().describe('baseMeasure paid/amount: the rule read, by name'),
        baseInputName: z
          .string()
          .optional()
          .describe('baseMeasure input: the name of the dated figure (see set_activity_inputs)'),
        basePeriodRef: PERIOD_REF.optional(),
        baseCoefficient: z
          .number()
          .nullable()
          .optional()
          .describe(
            'Multiplies the measure first, e.g. 0.75 for a regime taxing three quarters of the receipts',
          ),
        baseAddBackLevies: z
          .array(z.string())
          .nullable()
          .optional()
          .describe('Rules whose settlements are added back to the base before the abatement, by name'),
        baseAbatement: abatementSchema
          .nullable()
          .optional()
          .describe(
            "What comes off the base: {rate, minAmount?} for a flat share, or {brackets: [{upTo, rate}], on: {measure, periodRef}} for a share picked by a table read on another measure, typically last year's profit. Rates are percentages",
          ),
        baseFloor: z.number().nullable().optional().describe('The base is at least this'),
        baseCap: z.number().nullable().optional().describe('The base is at most this'),
        baseCredits: z
          .array(creditInput)
          .nullable()
          .optional()
          .describe(
            "What is credited against the base, each a share of withholdings or of another rule's settlements or amount",
          ),
        baseScale: z
          .enum(['none', 'per_month', 'per_period', 'annualized'])
          .optional()
          .describe(
            "none: the measure as read. per_month: a yearly measure divided by the months the activity was open, for a monthly rule. per_period: a yearly measure divided by the number of the rule's own periods in a year (a quarterly instalment takes a quarter of it), so the rate stays the rate the text fixes. annualized: a partial year scaled up to a full one",
          ),
        amountForm: z.enum(['rate', 'brackets', 'elective_base', 'fixed', 'none']).optional(),
        rate: z
          .number()
          .nullable()
          .optional()
          .describe('amountForm rate: the percentage applied to the base'),
        brackets: bracketsSchema
          .nullable()
          .optional()
          .describe(
            'amountForm brackets: {mode: progressive|step, rows: [{upTo, rate?, amount?}]}, rows ordered by upTo ascending, the last row upTo null (open). Percentages for rate',
          ),
        elective: electiveSchema
          .nullable()
          .optional()
          .describe(
            "amountForm elective_base: {rows: [{upTo, minBase, maxBase}], inputName, rate}. The reference (the base block) falls in a row; the user's chosen base, stored as the dated input inputName, must sit within that row's bounds; the amount is rate % of it",
          ),
        fixedAmount: z.number().nullable().optional().describe('amountForm fixed: the amount per period'),
        fixedInputName: z
          .string()
          .nullable()
          .optional()
          .describe(
            'amountForm fixed: the dated input holding the amount instead (a notice the user types in)',
          ),
        fixedCredit: z.number().nullable().optional().describe('Taken off after the amount, every period'),
        creditInputName: z
          .string()
          .nullable()
          .optional()
          .describe(
            'A dated input of personal credits taken off after the amount, which the engine cannot compute',
          ),
        period: z
          .enum(['month', 'quarter', 'half', 'year'])
          .optional()
          .describe("The period each amount covers, counted from the activity's fiscal year start"),
        due: dueSchema
          .optional()
          .describe(
            'When a period is payable (required on create). {type: after_period, monthOffset?, fromDay?, toDay}: a window in the month monthOffset (default 1) after the period ends, from fromDay (default 1) to toDay. {type: end_of_next_month}. {type: fixed_dates, dates: [{month, day, yearOffset?}]}: days of the fiscal year, yearOffset 1 for the year after the period',
          ),
        declarationLagMonths: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('Months between the declaration and its payment when they differ'),
        firstDueAfterDays: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('Days after the activity start before the first return is due'),
        skipPeriods: skipPeriodsSchema
          .nullable()
          .optional()
          .describe(
            'Periods folded into another return, by index in the fiscal year: {quarter: [4]} for a fourth quarter absorbed by the annual return',
          ),
        regularization: z.enum(['none', 'annual_deadzone', 'provisional_then_settled']).optional(),
        regularizationParams: regularizationParamsSchema
          .nullable()
          .optional()
          .describe(
            '{settleMonthOffset?, refundMonthOffset?}: months after the fiscal year end when the difference is settled, and when a refund arrives',
          ),
        settlementCategory: z
          .string()
          .nullable()
          .optional()
          .describe(
            'The expense category whose movements pay this rule, by name. Create it first with manage_categories if needed',
          ),
        deductible: z
          .boolean()
          .optional()
          .describe(
            'Paying this rule reduces the profit (a social contribution often does, an income tax never)',
          ),
        passThrough: z
          .boolean()
          .optional()
          .describe('Neither revenue nor charge: VAT, collected for the state and owed to it'),
        note: z.string().nullable().optional(),
        modifierLabel: z
          .string()
          .optional()
          .describe(
            'add_modifier: what the user asserts (e.g. "reduced rate, first year"); remove_modifier: the modifier to drop, by label or modifierId',
          ),
        effect: z
          .enum(['rate_factor', 'replace_amount', 'coefficient', 'exempt'])
          .optional()
          .describe(
            'add_modifier: rate_factor multiplies the rate by value (0.75 for a quarter off), replace_amount pays value instead of the computed amount, coefficient multiplies the base by value, exempt pays nothing',
          ),
        value: z
          .number()
          .optional()
          .describe('add_modifier: the factor, coefficient or amount; none for exempt'),
        startsOn: isoDate.optional().describe("add_modifier: first day, the activity's start by default"),
        durationMonths: z.number().int().optional().describe('add_modifier: calendar months it lasts'),
        durationPeriods: z.number().int().optional().describe('add_modifier: periods of the rule it lasts'),
        endsOn: isoDate
          .optional()
          .describe('add_modifier: last day; at most one of durationMonths, durationPeriods, endsOn'),
        condition: z
          .string()
          .optional()
          .describe(
            'add_modifier: the eligibility condition the user asserts, in their words; the screen repeats it, the engine never checks it',
          ),
      }),
    },
    async (a) =>
      run(async () => {
        const activity = await requireActivityByName(userId, a.activity)
        const names = async () => new Map((await listLevies(userId, activity.id)).map((l) => [l.id, l.name]))
        const categoryNames = async () => new Map((await listCategories(userId)).map((c) => [c.id, c.name]))
        const resolveLevyName = async (ref: string) => (await requireLevy(userId, activity.id, ref)).id

        if (a.action === 'list') {
          const [levies, byId, categories] = await Promise.all([
            listLevies(userId, activity.id, { at: a.at }),
            names(),
            categoryNames(),
          ])
          return ok({
            activity: activity.name,
            at: a.at ?? 'all validities',
            levies: levies.map((levy) => view(levy, byId, categories)),
          })
        }

        if (a.action === 'create' || a.action === 'update' || a.action === 'supersede') {
          if (a.action !== 'update') {
            if (!a.verifiedOn)
              return fail(
                `${a.action} requires verifiedOn: the day you read the official text. Read it now if you have not; never write a value from memory.`,
              )
            if (!a.sourceUrl && a.status !== 'unconfirmed')
              return fail(
                `${a.action} requires sourceUrl: the URL of the text fixing these values. If no text fixes them yet, pass status unconfirmed and say so to the user.`,
              )
          }
          const credits =
            a.baseCredits === undefined
              ? undefined
              : a.baseCredits === null
                ? null
                : await Promise.all(
                    a.baseCredits.map(async (c) => ({
                      source: c.source,
                      levyId: c.levy ? await resolveLevyName(c.levy) : undefined,
                      share: c.share,
                      periodRef: c.periodRef,
                    })),
                  )
          const patch: LevyEdit = {
            name: a.name,
            kind: a.kind,
            validTo: a.validTo,
            sourceUrl: a.sourceUrl,
            verifiedOn: a.verifiedOn,
            reviewOn: a.reviewOn,
            status: a.status,
            baseMeasure: a.baseMeasure,
            baseLevyId: a.baseLevy ? await resolveLevyName(a.baseLevy) : undefined,
            baseInputName: a.baseInputName,
            basePeriodRef: a.basePeriodRef,
            baseCoefficient: a.baseCoefficient,
            baseAbatement: a.baseAbatement,
            baseAddBackLevyIds:
              a.baseAddBackLevies === undefined
                ? undefined
                : a.baseAddBackLevies === null
                  ? null
                  : await Promise.all(a.baseAddBackLevies.map(resolveLevyName)),
            baseFloor: a.baseFloor,
            baseCap: a.baseCap,
            baseCredits: credits,
            baseScale: a.baseScale,
            amountForm: a.amountForm,
            rate: a.rate,
            brackets: a.brackets,
            elective: a.elective,
            fixedAmount: a.fixedAmount,
            fixedInputName: a.fixedInputName,
            fixedCredit: a.fixedCredit,
            creditInputName: a.creditInputName,
            period: a.period,
            due: a.due,
            declarationLagMonths: a.declarationLagMonths,
            firstDueAfterDays: a.firstDueAfterDays,
            skipPeriods: a.skipPeriods,
            regularization: a.regularization,
            regularizationParams: a.regularizationParams,
            settlementCategoryId:
              a.settlementCategory === undefined
                ? undefined
                : a.settlementCategory === null
                  ? null
                  : (await requireCategoryByName(userId, a.settlementCategory)).id,
            deductible: a.deductible,
            passThrough: a.passThrough,
            note: a.note,
          }
          const [byId, categories] = await Promise.all([names(), categoryNames()])
          if (a.action === 'create') {
            const missing = (
              ['name', 'kind', 'validFrom', 'baseMeasure', 'amountForm', 'period', 'due'] as const
            ).filter((key) => a[key] === undefined)
            if (missing.length > 0) return fail(`create requires ${missing.join(', ')}.`)
            const levy = await createLevy(userId, {
              ...patch,
              activityId: activity.id,
              name: a.name!,
              kind: a.kind!,
              validFrom: a.validFrom!,
              baseMeasure: a.baseMeasure!,
              amountForm: a.amountForm!,
              period: a.period!,
              due: a.due,
            })
            return ok({ created: view({ ...levy, modifiers: [] }, byId, categories) })
          }
          if (!a.levy) return fail(`${a.action} requires levy: the rule, by name or levyId.`)
          const target = await requireLevy(userId, activity.id, a.levy)
          if (a.action === 'update') {
            if (a.validFrom) patch.validFrom = a.validFrom
            const updated = await editLevy(userId, target.id, patch)
            return ok({
              updated: view({ ...updated, modifiers: target.modifiers }, byId, categories),
              note: 'Corrected in place. If the value actually changed on a date, undo this with the former values and use supersede instead.',
            })
          }
          if (!a.validFrom) return fail('supersede requires validFrom: the first day the new values apply.')
          const { closed, created } = await supersedeLevy(userId, target.id, {
            ...patch,
            validFrom: a.validFrom,
          })
          const refreshed = new Map([...byId, [created.id, created.name]])
          return ok({
            closed: {
              levyId: closed.id,
              name: closed.name,
              validFrom: closed.validFrom,
              validTo: closed.validTo,
            },
            created: view(
              { ...created, modifiers: (await requireLevy(userId, activity.id, created.id)).modifiers },
              refreshed,
              categories,
            ),
          })
        }

        if (!a.levy) return fail(`${a.action} requires levy: the rule, by name or levyId.`)
        const target = await requireLevy(userId, activity.id, a.levy)
        if (a.action === 'close') {
          if (!a.validTo) return fail('close requires validTo: the last day the rule applies.')
          const closed = await closeLevy(userId, target.id, a.validTo)
          return ok({
            levyId: closed.id,
            name: closed.name,
            validFrom: closed.validFrom,
            validTo: closed.validTo,
          })
        }
        if (a.action === 'delete') {
          await deleteLevy(userId, target.id)
          return ok({ deleted: target.name, validFrom: target.validFrom })
        }
        if (a.action === 'add_modifier') {
          if (!a.modifierLabel || !a.effect) return fail('add_modifier requires modifierLabel and effect.')
          const modifier = await addModifier(userId, target.id, {
            label: a.modifierLabel,
            effect: a.effect,
            value: a.value,
            startsOn: a.startsOn,
            durationMonths: a.durationMonths,
            durationPeriods: a.durationPeriods,
            endsOn: a.endsOn,
            condition: a.condition,
            sourceUrl: clearable(a.sourceUrl ?? undefined),
            verifiedOn: a.verifiedOn,
            status: a.status,
          })
          return ok({ levy: target.name, modifier: modifierView(modifier) })
        }
        if (!a.modifierLabel)
          return fail('remove_modifier requires modifierLabel: the modifier, by label or modifierId.')
        const wanted = a.modifierLabel.trim().toLowerCase()
        const modifier = target.modifiers.find(
          (m) => m.id === a.modifierLabel || m.label.toLowerCase() === wanted,
        )
        if (!modifier)
          return fail(
            `No modifier "${a.modifierLabel}" on "${target.name}". Its modifiers: ${target.modifiers.map((m) => m.label).join(', ') || 'none'}.`,
          )
        await removeModifier(userId, modifier.id)
        return ok({ levy: target.name, removed: modifier.label })
      }),
  )

  server.registerTool(
    'set_activity_inputs',
    {
      description:
        "Dated figures a rule reads and the engine cannot compute: the contribution base the user chose within their bracket, last year's profit from before this ledger existed, the amount on a tax notice, an estimated marginal rate, personal credits. A rule refers to one by name (baseInputName, fixedInputName, creditInputName, elective.inputName); the value in force at a date is the latest stated on or before it, so a change is a new dated value, never an overwrite. Actions: set (state a value from a date; the same name on the same day replaces the value), list, remove (by name and validFrom). Names are the user's, stable, in snake_case; reuse the exact name the rule reads.",
      inputSchema: z.object({
        action: z.enum(['set', 'list', 'remove']),
        activity: z.string().describe('The business activity, by name'),
        name: z.string().optional().describe("set/remove: the figure's name, exactly as the rule reads it"),
        validFrom: isoDate.optional().describe('set/remove: the first day the value applies'),
        value: z
          .number()
          .optional()
          .describe('set: the value, in the unit the rule expects (euros, or a percentage)'),
        note: z
          .string()
          .optional()
          .describe('set: where the figure comes from, e.g. the notice or the choice made'),
      }),
    },
    async (a) =>
      run(async () => {
        const activity = await requireActivityByName(userId, a.activity)
        if (a.action === 'list') {
          const inputs = await listInputs(userId, activity.id)
          return ok({
            activity: activity.name,
            inputs: inputs.map((i) => ({
              name: i.name,
              validFrom: i.validFrom,
              value: Number(i.value),
              note: i.note ?? undefined,
            })),
          })
        }
        if (!a.name || !a.validFrom) return fail(`${a.action} requires name and validFrom.`)
        if (a.action === 'set') {
          if (a.value === undefined) return fail('set requires value.')
          const input = await setInput(userId, activity.id, {
            name: a.name,
            validFrom: a.validFrom,
            value: a.value,
            note: a.note,
          })
          return ok({ name: input.name, validFrom: input.validFrom, value: Number(input.value) })
        }
        const inputs = await listInputs(userId, activity.id)
        const wanted = a.name.trim()
        const input = inputs.find((i) => i.name === wanted && i.validFrom === a.validFrom)
        if (!input)
          return fail(
            `No value of "${wanted}" from ${a.validFrom}. Stated: ${inputs.map((i) => `${i.name} from ${i.validFrom}`).join(', ') || 'none'}.`,
          )
        await removeInput(userId, input.id)
        return ok({ removed: input.name, validFrom: input.validFrom })
      }),
  )

  server.registerTool(
    'manage_thresholds',
    {
      description:
        'The thresholds a regime hinges on: a measure over a period reference against a value, and the sentence saying what changes past it (a VAT exemption lost, a flat-rate regime left, an instalment waived, a filing that turns monthly). A threshold alerts; the engine never switches a regime on its own, because leaving one is a gesture (add the VAT rule, close the activity and open the next). Actions: list, create, update, remove. A threshold carries a source and dates like a rule: never state its value from memory.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'remove']),
        activity: z.string().describe('The business activity, by name'),
        threshold: z.string().optional().describe('update/remove: the threshold, by label or thresholdId'),
        label: z.string().optional().describe('create: a short label; update: the corrected label'),
        measure: z
          .enum([
            'revenue',
            'revenue_incl_vat',
            'expenses',
            'profit',
            'vat_balance',
            'withholdings',
            'withholding_share',
          ])
          .optional()
          .describe(
            'What is watched. withholding_share: the share of receipts that bore a withholding, in percent',
          ),
        periodRef: PERIOD_REF.optional().describe('Period the measure is read over, ytd by default'),
        comparison: z
          .enum(['lte', 'gte'])
          .optional()
          .describe(
            'lte (default): the regime holds while the measure stays at or under the value. gte: while it stays at or above',
          ),
        value: z.number().optional().describe('The value, in the unit of the measure'),
        consequence: z
          .string()
          .optional()
          .describe('What changes past the value, in one sentence the user reads'),
        sourceUrl: z.string().nullable().optional().describe('URL of the text fixing the value'),
        verifiedOn: isoDate.optional().describe('The day you read it'),
        reviewOn: isoDate.nullable().optional().describe('The day to check it again'),
      }),
    },
    async (a) =>
      run(async () => {
        const activity = await requireActivityByName(userId, a.activity)
        if (a.action === 'list')
          return ok({
            activity: activity.name,
            thresholds: (await listThresholds(userId, activity.id)).map(thresholdView),
          })
        if (a.action === 'create') {
          const missing = (['label', 'measure', 'value', 'consequence'] as const).filter(
            (key) => a[key] === undefined,
          )
          if (missing.length > 0) return fail(`create requires ${missing.join(', ')}.`)
          const threshold = await createThreshold(userId, activity.id, {
            label: a.label!,
            measure: a.measure!,
            periodRef: a.periodRef,
            comparison: a.comparison,
            value: a.value!,
            consequence: a.consequence!,
            sourceUrl: a.sourceUrl,
            verifiedOn: a.verifiedOn,
            reviewOn: a.reviewOn,
          })
          return ok(thresholdView(threshold))
        }
        if (!a.threshold)
          return fail(`${a.action} requires threshold: the threshold, by label or thresholdId.`)
        const thresholds = await listThresholds(userId, activity.id)
        const wanted = a.threshold.trim().toLowerCase()
        const target = thresholds.find((t) => t.id === a.threshold || t.label.toLowerCase() === wanted)
        if (!target)
          return fail(
            `No threshold "${a.threshold}" in this activity. Its thresholds: ${thresholds.map((t) => t.label).join(', ') || 'none'}.`,
          )
        if (a.action === 'remove') {
          await removeThreshold(userId, target.id)
          return ok({ removed: target.label })
        }
        const updated = await editThreshold(userId, target.id, {
          label: a.label,
          measure: a.measure,
          periodRef: a.periodRef,
          comparison: a.comparison,
          value: a.value,
          consequence: a.consequence,
          sourceUrl: a.sourceUrl,
          verifiedOn: a.verifiedOn,
          reviewOn: a.reviewOn,
        })
        return ok(thresholdView(updated))
      }),
  )
}
