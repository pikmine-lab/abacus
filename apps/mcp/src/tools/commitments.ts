import { DomainError } from '@abacus/core/domain/errors'
import { resolveSort } from '@abacus/core/domain/sort'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  COMMITMENT_SORTS,
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createInvestmentPlan,
  createSubscription,
  DEFAULT_COMMITMENT_SORT,
  editCommitment,
  financingSchedule,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  moveAccount,
  reviseSchedule,
  setJudgment,
  skipNextOccurrence,
  sortCommitments,
} from '@abacus/core/services/commitments'
import { listAssets } from '@abacus/core/services/investments'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireAssetByName,
  requireCategoryByName,
  requireCommitment,
} from '../resolve.ts'
import { clearable, fail, GUIDANCE, isoDate, ok, orderedBy, run, sortDirection } from './shared.ts'

export function registerCommitmentTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_subscription',
    {
      description:
        'Manages subscriptions and recurring incomes (open-ended commitments). Actions: create (new subscription, or a salary with direction incoming), change_price (the price changed: the dated history is kept, which is how raises become visible), set_judgment (essential / reducible / to_cancel, with a note), cancel (no more occurrences). For an installment purchase use declare_financing. To correct what the commitment says about itself (label, actor, account, category, periodicity), use update_commitment: a mistyped label is a correction, not a price change. The actual debit of each occurrence is confirmed through confirm_due_movements, never through declare_movements.',
      inputSchema: z.object({
        action: z.enum(['create', 'change_price', 'set_judgment', 'cancel']),
        commitment: z
          .string()
          .optional()
          .describe('Every action except create: label (or id) of the commitment'),
        label: z.string().optional().describe('create: subscription name (e.g. "Netflix")'),
        actor: z.string().optional().describe('create: the actor debiting (or paying, if incoming)'),
        account: z.string().optional().describe('create: the debited (or credited) account'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('create: amount per period; change_price: the new amount'),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe(
            "create/change_price: ISO 4217 code the commitment bills in, when not euros (a US SaaS in USD). Each confirmed occurrence converts at its own day's rate, like any movement. On change_price it moves with the new price (a service that starts billing in euros); past events keep their currency",
          ),
        periodUnit: z.enum(['week', 'month', 'year']).optional().describe('create: defaults to month'),
        periodCount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('create: every N periods, defaults to 1'),
        firstDueOn: isoDate.optional().describe('create: next expected occurrence'),
        direction: z
          .enum(['outgoing', 'incoming'])
          .optional()
          .describe('create: incoming for a recurring income (salary), defaults to outgoing'),
        category: z.string().optional().describe('create: category of the generated movements'),
        activity: z
          .string()
          .optional()
          .describe('create: sphere of the generated movements (e.g. Freelance)'),
        judgment: z.enum(['essential', 'reducible', 'to_cancel']).optional().describe('create/set_judgment'),
        judgmentNote: z.string().optional(),
        engagedUntil: isoDate.optional().describe('create: end of the contractual lock-in period, if any'),
        effectiveOn: isoDate.optional().describe('change_price/cancel: effective date, defaults to today'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'create') {
          if (!a.label || !a.actor || !a.account || !a.amount || !a.firstDueOn)
            return fail('create requires label, actor, account, amount and firstDueOn.')
          const commitment = await createSubscription(userId, {
            label: a.label,
            actorId: (await requireActorByName(userId, a.actor, { createIfUnknown: true })).actor.id,
            accountId: (await requireAccountByName(userId, a.account)).id,
            direction: a.direction,
            amount: a.amount,
            currency: a.currency,
            periodUnit: a.periodUnit ?? 'month',
            periodCount: a.periodCount,
            firstDueOn: a.firstDueOn,
            categoryId: a.category ? (await requireCategoryByName(userId, a.category)).id : undefined,
            activityId: a.activity ? (await requireActivityByName(userId, a.activity)).id : undefined,
            judgment: a.judgment,
            judgmentNote: a.judgmentNote,
            engagedUntil: a.engagedUntil,
          })
          return ok({ commitmentId: commitment.id, label: commitment.label, nextDueOn: commitment.nextDueOn })
        }
        if (!a.commitment) return fail(`${a.action} requires commitment (label or id).`)
        const target = await requireCommitment(userId, a.commitment)
        if (a.action === 'change_price') {
          if (!a.amount) return fail('change_price requires amount (the new price).')
          const updated = await changeAmount(userId, target.id, a.amount, a.effectiveOn, {
            currency: a.currency,
          })
          return ok({
            commitmentId: updated.id,
            amount: Number(updated.amount),
            ...(updated.currency !== 'EUR' ? { currency: updated.currency } : {}),
            note: 'Change recorded in the dated history.',
          })
        }
        if (a.action === 'set_judgment') {
          if (!a.judgment) return fail('set_judgment requires judgment.')
          const updated = await setJudgment(userId, target.id, a.judgment, a.judgmentNote)
          return ok({
            commitmentId: updated.id,
            judgment: updated.judgment,
            judgmentNote: updated.judgmentNote,
          })
        }
        const cancelled = await cancelCommitment(userId, target.id, a.effectiveOn)
        return ok({ commitmentId: cancelled.id, cancelledOn: cancelled.cancelledOn })
      }),
  )

  server.registerTool(
    'update_commitment',
    {
      description:
        'Corrects what an existing commitment says about itself: its label, who bills it, how it is filed (category, activity), how often it falls, a subscription lock-in date, and for an investment plan the asset it buys and the account it feeds. Works on subscriptions, recurring incomes, financings and investment plans alike, and is the tool for "it is not called that", "wrong category". What it never touches: the movements already recorded, which state what happened on the account it happened on, so the correction applies from the next occurrence onwards. Three things have their own tool: the amount and the currency it is billed in, because a price change is dated history (manage_subscription change_price), the account, because a debit that moves does so on a date (change_commitment_account), and the schedule of a financing (manage_financing_schedule). Turning an outgoing commitment into an incoming one is not a correction: cancel it and declare the right one, because its own past movements would contradict a flipped direction.',
      inputSchema: z.object({
        commitment: z.string().describe('Label (or id) of the commitment to correct'),
        label: z.string().optional().describe('New label'),
        actor: z
          .string()
          .optional()
          .describe('The actor billing (or paying) from now on. Must already exist'),
        category: z.string().optional().describe('Exact name of an existing category, or "none" to clear it'),
        activity: z.string().optional().describe('Existing activity name, or "none" to clear it'),
        periodUnit: z.enum(['week', 'month', 'year']).optional(),
        periodCount: z.number().int().positive().optional().describe('Every N periods'),
        engagedUntil: z
          .string()
          .optional()
          .describe('Subscription only: end of the contractual lock-in as YYYY-MM-DD, or "none" to clear it'),
        asset: z
          .string()
          .optional()
          .describe(
            'Investment plan only: the asset its next occurrences buy. The occurrences already confirmed keep what they really bought',
          ),
        targetAccount: z
          .string()
          .optional()
          .describe('Investment plan only: the investment account it feeds from now on'),
      }),
    },
    async (u) =>
      run(async () => {
        const target = await requireCommitment(userId, u.commitment)
        const category = clearable(u.category)
        const activity = clearable(u.activity)
        const updated = await editCommitment(userId, target.id, {
          label: u.label,
          actorId: u.actor ? (await requireActorByName(userId, u.actor)).actor.id : undefined,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          periodUnit: u.periodUnit,
          periodCount: u.periodCount,
          engagedUntil: clearable(u.engagedUntil),
          assetId: u.asset ? (await requireAssetByName(userId, u.asset)).id : undefined,
          targetAccountId: u.targetAccount
            ? (await requireAccountByName(userId, u.targetAccount)).id
            : undefined,
        })
        return ok({
          commitmentId: updated.id,
          label: updated.label,
          every: `${updated.periodCount} ${updated.periodUnit}`,
          engagedUntil: updated.engagedUntil ?? undefined,
          note: 'Applies from the next occurrence: the movements already recorded are unchanged.',
        })
      }),
  )

  server.registerTool(
    'change_commitment_account',
    {
      description:
        'Moves a commitment to another account, from a date: "from next month that direct debit leaves the other account". The account a commitment hits is a dated history, like its amount, so this is an event and not a correction. Declare it the day it is learnt, future date included: every occurrence then lands on the account in force on its own date, including one confirmed weeks late, which is what keeps both balances true. Movements already recorded are never rewritten. For what a commitment says about itself with no date (label, actor, category, periodicity), use update_commitment.',
      inputSchema: z.object({
        commitment: z.string().describe('Label (or id) of the commitment'),
        account: z.string().describe('The account it hits from that date on'),
        effectiveOn: isoDate
          .optional()
          .describe('The date the move takes effect, past or future. Defaults to today'),
      }),
    },
    async (m) =>
      run(async () => {
        const target = await requireCommitment(userId, m.commitment)
        const account = await requireAccountByName(userId, m.account)
        const updated = await moveAccount(userId, target.id, account.id, m.effectiveOn)
        const from = m.effectiveOn ?? 'today'
        return ok({
          commitmentId: updated.id,
          label: updated.label,
          account: account.name,
          effectiveOn: from,
          note: `Occurrences due before ${from} still land on the previous account, and movements already recorded are unchanged.`,
        })
      }),
  )

  server.registerTool(
    'declare_financing',
    {
      description:
        'Declares an installment purchase (financing): a total amount paid in N installments. Give the total and the number of installments and the schedule is written for you : equal amounts one period apart, the rounding cent on the last one. Pass installments instead when the real plan is not that: a prorated first month, uneven thirds, a date pushed off a weekend, a payment holiday. That is the normal case for a contract read off a paper, so prefer it whenever the user states actual dates or amounts. Whichever you pass, the installments must add up to the total. The remaining due is then the sum of what is still owed, and each installment is confirmed for its own amount through confirm_due_movements. A plan is not final once written: manage_financing_schedule revises it when reality moves (a date pushed back, an amount renegotiated, an installment added or dropped).',
      inputSchema: z.object({
        label: z.string().describe('What is being financed (e.g. "Sofa x4")'),
        actor: z.string().describe('The creditor (store, payment provider)'),
        account: z.string().describe('Account debited at each installment'),
        totalAmount: z.number().positive().describe('Total owed across every installment'),
        installmentsTotal: z.number().int().min(2).describe('Total number of installments'),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe(
            "ISO 4217 code the whole plan is written in (total and installments), when not euros. Fixed for the life of the plan; each confirmed installment converts at its own day's rate",
          ),
        firstDueOn: isoDate.describe('First installment date'),
        installments: z
          .array(
            z.object({
              dueOn: isoDate.describe('Date this installment is owed'),
              amount: z.number().positive().describe('Amount of this installment alone'),
            }),
          )
          .min(2)
          .optional()
          .describe(
            'The plan spelled out, in contractual order, one entry per installment. Use it as soon as the installments differ from each other or fall on irregular dates. Its length must equal installmentsTotal and its amounts must sum to totalAmount.',
          ),
        periodUnit: z
          .enum(['week', 'month', 'year'])
          .optional()
          .describe('Defaults to month; week with periodCount 2 for a pay-in-4 every two weeks'),
        periodCount: z.number().int().positive().optional(),
        category: z.string().optional(),
      }),
    },
    async (f) =>
      run(async () => {
        const commitment = await createFinancing(userId, {
          label: f.label,
          actorId: (await requireActorByName(userId, f.actor, { createIfUnknown: true })).actor.id,
          accountId: (await requireAccountByName(userId, f.account)).id,
          installments: f.installments,
          installmentsTotal: f.installmentsTotal,
          totalAmount: f.totalAmount,
          currency: f.currency,
          periodUnit: f.periodUnit,
          periodCount: f.periodCount,
          firstDueOn: f.firstDueOn,
          categoryId: f.category ? (await requireCategoryByName(userId, f.category)).id : undefined,
        })
        return ok({
          commitmentId: commitment.id,
          label: commitment.label,
          totalAmount: Number(commitment.totalAmount),
          installmentsTotal: commitment.installmentsTotal,
          schedule: (await financingSchedule(userId, commitment.id)).map((i) => ({
            position: i.position,
            dueOn: i.dueOn,
            amount: Number(i.amount),
          })),
        })
      }),
  )

  server.registerTool(
    'manage_financing_schedule',
    {
      description:
        "Reads and revises the written plan of a financing. show lists every installment with its id, its date, its amount and whether it is already paid. revise replaces that plan with the one you pass: this is how a pushed-back date, a renegotiated amount, an extra installment or an early settlement gets recorded, and the remaining due follows. Always show before revise, because a revision is the whole plan, not a patch: keep the id of every installment you keep, omit the id to add one, and leave a line out to drop it (dropping a paid one deletes the movement that paid it, so only do that when the installment never was owed). The total owed becomes the sum of the plan, so a renegotiation is expressible instead of blocked. Every amount is in the plan's own currency (shown by show; euros unless said otherwise). Fixing what was really debited on a paid installment can also be done through fix_movement: both sides stay in sync either way.",
      inputSchema: z.object({
        action: z.enum(['show', 'revise']),
        commitment: z.string().describe('Label (or id) of the financing'),
        installments: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe('Id of the installment this line keeps, from show. Omit to add a new one'),
              dueOn: isoDate.describe('Date this installment is owed'),
              amount: z.number().positive().describe('Amount of this installment alone'),
            }),
          )
          .min(1)
          .optional()
          .describe('revise: the complete plan you want, in contractual order'),
      }),
    },
    async ({ action, commitment, installments }) =>
      run(async () => {
        const target = await requireCommitment(userId, commitment)
        if (target.kind !== 'financing')
          return fail(GUIDANCE.not_a_financing ?? 'Only a financing carries a written schedule.')
        if (action === 'revise' && !installments)
          return fail('revise requires installments: the whole plan you want, one entry per installment.')
        const financing =
          action === 'revise' ? await reviseSchedule(userId, target.id, installments!) : target
        return ok({
          commitmentId: financing.id,
          label: financing.label,
          totalAmount: Number(financing.totalAmount),
          // The whole plan is written in this currency: revise in it too.
          ...(financing.currency !== 'EUR' ? { currency: financing.currency } : {}),
          nextDueOn: financing.nextDueOn,
          installments: (await financingSchedule(userId, financing.id)).map((i) => ({
            id: i.id,
            position: i.position,
            dueOn: i.dueOn,
            amount: Number(i.amount),
            status: i.movementId ? 'paid' : 'due',
          })),
        })
      }),
  )

  server.registerTool(
    'manage_investment_plan',
    {
      description:
        "Manages a scheduled placement: a fixed sum in euros that leaves one account for an investment account at a regular interval and buys an asset there (an automatic monthly payment into an ETF at a broker). Actions: create, change_amount (the instalment moved: the dated history is kept), cancel (no more occurrences). It is not a subscription and not an expense: an occurrence is an internal transfer, so it carries no actor and no category, and buying changes the form of the money rather than spending it. Both accounts are the user's own: the source is any account, often the broker's own cash account, and the target must be an investment account. The asset must already exist (manage_assets, which is also where an unknown fund is looked up). Each occurrence is confirmed through confirm_due_movements, which requires the quantity bought: nothing here can derive it. To correct what the plan says about itself (label, periodicity, the asset, the account it feeds) use update_commitment; to move the account the money leaves, change_commitment_account.",
      inputSchema: z.object({
        action: z.enum(['create', 'change_amount', 'cancel']),
        commitment: z.string().optional().describe('change_amount/cancel: label (or id) of the plan'),
        label: z.string().optional().describe('create: what the user calls it (e.g. "Versement MSCI World")'),
        account: z.string().optional().describe('create: the account the money leaves'),
        targetAccount: z
          .string()
          .optional()
          .describe('create: the investment account it feeds, where the purchase lands'),
        asset: z.string().optional().describe('create: the asset each occurrence buys. Must already exist'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe(
            'create: what is paid in each period, in euros; change_amount: the new instalment. Euros only: an occurrence writes a purchase, and operations are not multi-currency',
          ),
        periodUnit: z.enum(['week', 'month', 'year']).optional().describe('create: defaults to month'),
        periodCount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('create: every N periods, defaults to 1'),
        firstDueOn: isoDate.optional().describe('create: next expected occurrence'),
        activity: z.string().optional().describe('create: sphere of the generated transfers, if any'),
        effectiveOn: isoDate.optional().describe('change_amount/cancel: effective date, defaults to today'),
      }),
    },
    async (p) =>
      run(async () => {
        if (p.action === 'create') {
          if (!p.label || !p.account || !p.targetAccount || !p.asset || !p.amount || !p.firstDueOn)
            return fail('create requires label, account, targetAccount, asset, amount and firstDueOn.')
          const target = await requireAccountByName(userId, p.targetAccount)
          const asset = await requireAssetByName(userId, p.asset)
          const plan = await createInvestmentPlan(userId, {
            label: p.label,
            accountId: (await requireAccountByName(userId, p.account)).id,
            targetAccountId: target.id,
            assetId: asset.id,
            amount: p.amount,
            periodUnit: p.periodUnit ?? 'month',
            periodCount: p.periodCount,
            firstDueOn: p.firstDueOn,
            activityId: p.activity ? (await requireActivityByName(userId, p.activity)).id : undefined,
          })
          return ok({
            commitmentId: plan.id,
            label: plan.label,
            buys: asset.name,
            into: target.name,
            nextDueOn: plan.nextDueOn,
            note: 'Confirm each occurrence with confirm_due_movements, passing the quantity the broker shows.',
          })
        }
        if (!p.commitment) return fail(`${p.action} requires commitment (label or id).`)
        const plan = await requireCommitment(userId, p.commitment)
        if (p.action === 'change_amount') {
          if (!p.amount) return fail('change_amount requires amount (the new instalment).')
          const updated = await changeAmount(userId, plan.id, p.amount, p.effectiveOn)
          return ok({
            commitmentId: updated.id,
            amount: Number(updated.amount),
            note: 'Change recorded in the dated history.',
          })
        }
        const cancelled = await cancelCommitment(userId, plan.id, p.effectiveOn)
        return ok({ commitmentId: cancelled.id, cancelledOn: cancelled.cancelledOn })
      }),
  )

  server.registerTool(
    'list_commitments',
    {
      description:
        'The commitments review: subscriptions with monthly-equivalent cost and judgment (essential / reducible / to_cancel), financings with paid installments and remaining due. This is the tool for "what could I cut?" and for tracking installment purchases. Includes cancelled ones only with includeCancelled. Ranked by monthly-equivalent cost, biggest first, which is the order the user sees on screen and the one "what costs me the most" is answered with: every money criterion ranks in euros, so a plan billed in another currency sits where its cost puts it and not where its face value would. The answer repeats the order it used.',
      inputSchema: z.object({
        includeCancelled: z.boolean().optional(),
        sortBy: z
          .enum(['monthly', 'amount', 'next', 'remaining', 'label'])
          .optional()
          .describe(
            'What the list is ordered on: monthly (default, the monthly equivalent in euros), amount (what is billed each time), next (the soonest occurrence first), remaining (financings only, what is still owed), label',
          ),
        direction: sortDirection,
      }),
    },
    async ({ includeCancelled, sortBy, direction }) =>
      run(async () => {
        const sort = resolveSort(COMMITMENT_SORTS, DEFAULT_COMMITMENT_SORT, sortBy, direction)
        const commitments = sortCommitments(
          await listCommitmentsWithProgress(userId, !includeCancelled),
          sort,
        )
        const names = new Map((await listAccounts(userId)).map((a) => [a.id, a.name]))
        // A move already declared for a later date belongs in the review: it is
        // state nothing else would show before the day it takes effect.
        const account = (c: (typeof commitments)[number]) => ({
          account: names.get(c.accountId),
          movingTo: c.nextAccountMove
            ? { account: names.get(c.nextAccountMove.accountId), on: c.nextAccountMove.effectiveOn }
            : undefined,
        })
        const assetNames = new Map((await listAssets(userId)).map((a) => [a.id, a.name]))
        const view = commitments.map((c) => {
          if (c.kind === 'investment_plan') {
            return {
              type: 'investment_plan',
              label: c.label,
              id: c.id,
              ...account(c),
              amount: Number(c.amount),
              every: `${c.periodCount} ${c.periodUnit}`,
              // Saving, not spending: the caller must not add this into a cost
              // total beside the subscriptions.
              monthlyInvested: monthlyEquivalentEur(c),
              buys: assetNames.get(c.assetId ?? ''),
              into: names.get(c.targetAccountId ?? ''),
              cancelledOn: c.cancelledOn ?? undefined,
              nextDueOn: c.nextDueOn,
            }
          }
          if (c.kind === 'financing' && c.progress) {
            return {
              type: 'financing',
              label: c.label,
              id: c.id,
              ...account(c),
              // The plan's own currency: installment, remaining due and total
              // are all stated in it.
              ...(c.currency !== 'EUR' ? { currency: c.currency } : {}),
              installment: Number(c.amount),
              paidInstallments: `${c.progress.paidInstallments}/${c.installmentsTotal}`,
              remainingDue: c.progress.remainingDue,
              nextDueOn: c.progress.paidInstallments >= (c.installmentsTotal ?? 0) ? 'settled' : c.nextDueOn,
            }
          }
          return {
            type: 'subscription',
            label: c.label,
            id: c.id,
            ...account(c),
            direction: c.direction,
            amount: Number(c.amount),
            ...(c.currency !== 'EUR' ? { currency: c.currency } : {}),
            every: `${c.periodCount} ${c.periodUnit}`,
            // Always in euros (latest rate on a foreign commitment), so the
            // caller can add these up.
            monthlyEquivalent: monthlyEquivalentEur(c),
            judgment: c.judgment ?? 'not judged',
            judgmentNote: c.judgmentNote ?? undefined,
            engagedUntil: c.engagedUntil ?? undefined,
            cancelledOn: c.cancelledOn ?? undefined,
            nextDueOn: c.nextDueOn,
          }
        })
        return ok({ order: orderedBy(sort), commitments: view })
      }),
  )

  server.registerTool(
    'confirm_due_movements',
    {
      description:
        "Processes commitment occurrences that reached their date (listed by get_overview): confirm turns the expected occurrence into a real movement and advances the commitment by one period; skip advances without creating a movement (free month, paused service, a placement suspended for a month). When reality differed, pass the real amount : recording the truth always wins over the expectation, and that divergence is how silent price bumps get noticed. Then say which kind of divergence it was with amountIsTheNewNorm: a salary that moved for one month (short month, bonus) is a one-off, a raise or a price increase is permanent and must be recorded as such. If the user has not said which, ask before confirming. An investment plan is the one kind that cannot be confirmed on its own: it also writes the purchase, so it requires quantity, the units the broker says the order bought. Never compute that from a price: the order executed at an intraday price, and a quantity derived from a daily close would set a false average cost that drifts further with every occurrence. If the user has not given it, ask. Always prefer this tool over declare_movements for a subscription debit, and over record_investment_operations for a plan's purchase, otherwise the occurrence stays pending.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              commitment: z.string().describe('Label (or id) of the commitment'),
              action: z.enum(['confirm', 'skip']),
              amount: z
                .number()
                .positive()
                .optional()
                .describe('confirm: the real amount when it differs from the expected one'),
              amountIsTheNewNorm: z
                .boolean()
                .optional()
                .describe(
                  'confirm + amount: true when that amount replaces the expected one from now on (a raise, a price increase). It updates the commitment and records a dated price change, so the history shows when it moved. Leave it out or false for a one-off month, which changes nothing for the next occurrences.',
                ),
              date: isoDate.optional().describe('confirm: the real date when it differs from the due date'),
              eurAmount: z
                .number()
                .positive()
                .optional()
                .describe(
                  "confirm, foreign-currency commitment only: the euros the bank actually moved, when the statement shows them. Omitted: computed at the occurrence day's rate. The amount field stays in the commitment's own currency either way",
                ),
              quantity: z
                .number()
                .positive()
                .optional()
                .describe(
                  'confirm, investment plan only and required there: how many units the order bought, as the broker states them. Fractions are normal. Never derive it from a price',
                ),
              investedAmount: z
                .number()
                .positive()
                .optional()
                .describe(
                  'confirm, investment plan only: what was really invested, when the broker did not invest the whole instalment (it buys no fractions). The remainder then stays in the account cash, which is where it sits at the broker. Omitted: the whole instalment, order fees included, which is what makes the average cost match theirs',
                ),
            }),
          )
          .min(1),
      }),
    },
    async ({ items }) => {
      const results: unknown[] = []
      const names = new Map((await listAccounts(userId)).map((a) => [a.id, a.name]))
      for (const item of items) {
        try {
          const commitment = await requireCommitment(userId, item.commitment)
          if (item.action === 'skip') {
            const updated = await skipNextOccurrence(userId, commitment.id)
            results.push({ commitment: commitment.label, skipped: true, nextDueOn: updated.nextDueOn })
          } else {
            const expected = Number(commitment.amount)
            const { movement, operation } = await confirmNextOccurrence(userId, commitment.id, {
              amount: item.amount,
              happenedOn: item.date,
              updateReference: item.amountIsTheNewNorm,
              eurAmount: item.eurAmount,
              quantity: item.quantity,
              investedAmount: item.investedAmount,
            })
            const diverged = item.amount !== undefined && item.amount !== expected
            results.push({
              commitment: commitment.label,
              movementId: movement.id,
              amount: Number(movement.amount),
              ...(movement.originalCurrency
                ? { paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}` }
                : {}),
              // A plan wrote a purchase too, and its cash remainder is the one
              // thing a reader cannot infer from the amounts above.
              ...(operation
                ? {
                    bought: Number(operation.quantity),
                    invested: Number(operation.amount),
                    ...(Number(operation.amount) !== Number(movement.amount)
                      ? {
                          leftAsCash: Number((Number(movement.amount) - Number(operation.amount)).toFixed(2)),
                        }
                      : {}),
                  }
                : {}),
              // The account of the movement's own date: an occurrence confirmed
              // after the commitment moved lands on the one it really left.
              account: names.get(movement.sourceAccountId ?? movement.targetAccountId ?? ''),
              ...(diverged
                ? {
                    expected,
                    reference: item.amountIsTheNewNorm
                      ? `Updated to ${item.amount} ${commitment.currency} and recorded as a dated price change.`
                      : `Left at ${expected} ${commitment.currency}, treated as a one-off. Pass amountIsTheNewNorm if it is permanent.`,
                  }
                : {}),
            })
          }
        } catch (e) {
          if (e instanceof DomainError)
            results.push({ commitment: item.commitment, ok: false, error: GUIDANCE[e.code] ?? e.message })
          else throw e
        }
      }
      return ok({ results })
    },
  )
}
