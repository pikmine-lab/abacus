import * as z from 'zod'

/**
 * The shapes of the JSON parameters a levy row carries (migration 0018). This
 * is the one place both interfaces validate them: the web form and the MCP tool
 * parse with these schemas before a row is written, and the engine trusts what
 * it reads because nothing else ever wrote it.
 *
 * Amounts and rates are plain numbers here, not the numeric strings of the row
 * types: these documents are parameters, never money the database sums.
 */

const periodRef = z.enum(['current', 'ytd', 'year-1', 'year-2', 'rolling-12'])
const measure = z.enum(['revenue', 'revenue_incl_vat', 'expenses', 'profit', 'vat_balance', 'withholdings'])

/** A percentage between 0 and 100. */
const percent = z.number().min(0).max(100)

/**
 * One row of a table read against a base: everything up to `upTo` (null for
 * the last, open row). A table is ordered by `upTo` ascending, last row open.
 */
const bracketRow = z.object({
  upTo: z.number().positive().nullable(),
  rate: percent.optional(),
  amount: z.number().min(0).optional(),
})

/**
 * What comes off the base before the amount is computed: a fixed share (a
 * flat-rate allowance), or a share chosen by a bracket table read on another
 * measure, typically last year's profit. `minAmount` is the floor some regimes
 * give the allowance itself.
 */
export const abatementSchema = z.union([
  z.object({ rate: percent, minAmount: z.number().min(0).optional() }),
  z.object({
    brackets: z.array(z.object({ upTo: z.number().positive().nullable(), rate: percent })).min(1),
    on: z.object({ measure, periodRef }),
  }),
])
export type Abatement = z.infer<typeof abatementSchema>

/**
 * What is credited against the base: a share of the withholdings clients kept
 * back, the settlements of another levy (instalments against the annual tax),
 * or the computed amount of another levy.
 */
export const creditSchema = z.object({
  source: z.enum(['withholdings', 'paid', 'amount']),
  levyId: z.string().uuid().optional(),
  share: percent.default(100),
  periodRef: periodRef.default('current'),
})
export type Credit = z.infer<typeof creditSchema>
export const creditsSchema = z.array(creditSchema)

/**
 * A rate or amount table. `progressive` taxes each slice at its own rate (an
 * income tax schedule); `step` applies the row the whole base falls in (a
 * local tax by revenue bracket).
 */
export const bracketsSchema = z.object({
  mode: z.enum(['progressive', 'step']),
  rows: z.array(bracketRow).min(1),
})
export type Brackets = z.infer<typeof bracketsSchema>

/**
 * A base chosen by the user within the bounds of the row their reference
 * falls in, then taxed at a rate: a contribution by income bracket where the
 * bracket only bounds what one may declare. `inputName` is the dated input
 * holding the chosen base.
 */
export const electiveSchema = z.object({
  rows: z
    .array(
      z.object({
        upTo: z.number().positive().nullable(),
        minBase: z.number().min(0),
        maxBase: z.number().min(0),
      }),
    )
    .min(1),
  inputName: z.string().min(1),
  rate: percent,
})
export type Elective = z.infer<typeof electiveSchema>

/**
 * When a period's amount is due. `after_period` opens a window in the month(s)
 * following the period's end; `end_of_next_month` is its most common special
 * case; `fixed_dates` names days of the fiscal year (`yearOffset` 1 for the
 * year after the period).
 */
export const dueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('after_period'),
    monthOffset: z.number().int().min(0).default(1),
    fromDay: z.number().int().min(1).max(31).default(1),
    toDay: z.number().int().min(1).max(31),
  }),
  z.object({ type: z.literal('end_of_next_month') }),
  z.object({
    type: z.literal('fixed_dates'),
    dates: z
      .array(
        z.object({
          month: z.number().int().min(1).max(12),
          day: z.number().int().min(1).max(31),
          yearOffset: z.number().int().min(0).max(2).default(0),
        }),
      )
      .min(1),
  }),
])
export type Due = z.infer<typeof dueSchema>

/** Periods folded into another return, by their index within the fiscal year. */
export const skipPeriodsSchema = z.object({
  quarter: z.array(z.number().int().min(1).max(4)).optional(),
  month: z.array(z.number().int().min(1).max(12)).optional(),
  half: z.array(z.number().int().min(1).max(2)).optional(),
})
export type SkipPeriods = z.infer<typeof skipPeriodsSchema>

/**
 * How a provisional amount is settled later. `annual_deadzone`: the definitive
 * base of the closed year names a row of the elective table; nothing is owed if
 * the chosen base sits within its bounds, otherwise the difference to the
 * nearest bound, due in the next year and refunded by the one after.
 * `provisional_then_settled`: the periods ran on an older reference or a stated
 * figure; the definitive amount is recomputed on the closed year and the
 * difference is one dated instalment.
 */
export const regularizationParamsSchema = z.object({
  settleMonthOffset: z.number().int().min(1).max(24).optional(),
  refundMonthOffset: z.number().int().min(1).max(36).optional(),
})
export type RegularizationParams = z.infer<typeof regularizationParamsSchema>
