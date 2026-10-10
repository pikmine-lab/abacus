import type { Reading } from '../../domain/types.ts'
import type { Executor } from '../client.ts'
import { debitedOnly } from './cards.ts'

/**
 * The period clause of an analysis, in the reading it was asked for.
 *
 * Cash compares days. Accrual compares months, so the window rounds out to
 * whole months: an attachment holds a month and nothing finer, and cutting
 * September off on the 12th would drop everything attached to it without
 * saying so. A calendar period (a month, a year) is unaffected; only a rolling
 * window widens, and the caller is the one that names what it read.
 */
function inPeriod(tx: Executor, from: string, to: string, reading: Reading) {
  return reading === 'accrual'
    ? tx`and m.counted_in_month >= date_trunc('month', ${from}::date)
         and m.counted_in_month <= date_trunc('month', ${to}::date)`
    : tx`and m.happened_on >= ${from} and m.happened_on <= ${to}`
}

/**
 * What every analysis leaves out. A ghost movement did touch the account, so
 * balances still sum it, but it says nothing about the flows: left in, one
 * exceptional movement makes the month it lands in unreadable and every other
 * month read against it. A refund that is itself a ghost stops reducing the
 * net for the same reason: it would otherwise still move a figure here.
 */
function notGhost(tx: Executor) {
  return tx`and m.ghost = false`
}

/**
 * Every movement a flow analysis reads, as the CTE `flow`: the side it counts
 * on (`side`: income, expense, or null for a refund and a transfer), what of
 * it came back as linked refunds (`refunded`), and the share of it that counts
 * on that side (`scale`). A figure is `amount * scale` on the income side, and
 * `amount * scale` gross or `(amount - refunded) * scale` net on the expense
 * side. Each figure is computed per window, `window_start`: the whole period,
 * or each month when `byMonth`.
 *
 * A business activity is read by its net, the way a salary is read net of its
 * contributions. What its regime makes it pay (its expenses filed in a rule's
 * settlement category, the very payments its statement reads) is no expense
 * of its own: within a window those payments come off the activity's income,
 * each income keeping its share of what remains. When they exceed what it
 * received, the activity made a loss there: its incomes count for nothing,
 * and its payments count as expenses for what exceeds, each for its share.
 * Either way the net of the window does not move, and everything else the
 * activity spends stays an expense. A loss is a window's: a month that paid
 * the charges of the month before reads as a loss on its own, and as no loss
 * once read with it.
 *
 * Reading what the activity pays its owner as its income would be the other
 * way to get a net, and it is wrong: an expense of the activity would then
 * count without the money that paid it.
 */
function ledger(tx: Executor, userId: string, from: string, to: string, reading: Reading, byMonth = false) {
  const windowStart = !byMonth
    ? tx`${from}::date`
    : reading === 'accrual'
      ? tx`m.counted_in_month`
      : tx`date_trunc('month', m.happened_on)::date`
  return tx`
    counted as (
      select m.id, m.happened_on, m.note, m.kind, m.amount, m.activity_id, m.category_id,
             m.source_actor_id, m.target_actor_id, m.refunds_movement_id,
             ${windowStart} as window_start,
             coalesce(r.total, 0) as refunded,
             m.kind = 'expense' and exists (
               select 1 from levy l
               where l.activity_id = m.activity_id and l.settlement_category_id = m.category_id
             ) as settles
      from movement m
      left join lateral (
        select sum(amount) as total from movement r where r.refunds_movement_id = m.id and r.ghost = false
      ) r on true
      where m.user_id = ${userId}
        ${notGhost(tx)}
        ${inPeriod(tx, from, to, reading)}
    ),
    activity_net as (
      select window_start, activity_id,
             sum(amount) filter (where kind = 'income' and refunds_movement_id is null) as received,
             sum(amount - refunded) filter (where settles) as charged
      from counted
      where activity_id is not null
      group by window_start, activity_id
    ),
    flow as (
      select c.*,
             case when c.kind = 'income' and c.refunds_movement_id is null then 'income'
                  when c.kind = 'expense' then 'expense' end as side,
             case
               when c.kind = 'income'
                 then 1 - coalesce(least(coalesce(a.charged, 0), a.received) / a.received, 0)
               when c.settles
                 then coalesce(greatest(a.charged - coalesce(a.received, 0), 0) / nullif(a.charged, 0), 0)
               else 1
             end as scale
      from counted c
      left join activity_net a on a.window_start = c.window_start and a.activity_id = c.activity_id
    )
  `
}

export interface BalancePoint {
  day: string
  accountId: string
  balance: string
}

/**
 * Daily balance of every open account over a period: what the account already
 * held on its opening day, plus the running sum of all movements up to each
 * day. One query; the chart layer does no arithmetic.
 *
 * The window is honoured exactly as asked, days before the account opened
 * included (it holds nothing there, which is what an opening says). Choosing a
 * sensible `from` is the caller's job: see `firstDeclaredDay`.
 *
 * No reading to pick here, and there never will be one: a balance is the money
 * on the account on that day, so it sums settlement days and nothing else.
 */
export async function balanceSeries(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
): Promise<BalancePoint[]> {
  return await tx<BalancePoint[]>`
    with days as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    ),
    flows as (
      select f.account_id, f.happened_on, sum(f.delta) as delta
      -- A deferred card's purchase moves no balance until its debit is stated.
      from (
        select m.source_account_id as account_id, m.happened_on, -m.amount as delta
        from movement m where m.user_id = ${userId} and m.source_account_id is not null and ${debitedOnly(tx, 'm')}
        union all
        select m.target_account_id, m.happened_on, m.amount
        from movement m where m.user_id = ${userId} and m.target_account_id is not null and ${debitedOnly(tx, 'm')}
      ) f
      group by f.account_id, f.happened_on
    )
    select d.day, a.id as account_id,
           (case when a.opened_on <= d.day then a.opening_balance else 0 end
            + coalesce(sum(fl.delta) filter (where fl.happened_on <= d.day), 0))::numeric(14,2) as balance
    from days d
    cross join account a
    left join flows fl on fl.account_id = a.id
    where a.user_id = ${userId} and a.closed_on is null
    group by d.day, a.id
    order by d.day
  `
}

/**
 * Day the declared history starts, or null when nothing is declared. Views
 * that offer an open-ended period ("everything") clamp their window to it, so
 * a series does not start at the epoch.
 *
 * An account taken over with what it already held starts on its opening day,
 * before any movement: cutting the window at the first movement would hide the
 * plateau the opening draws, which is the whole account until then. An opening
 * of zero draws no plateau, so it does not stretch the window.
 */
export async function firstDeclaredDay(tx: Executor, userId: string): Promise<string | null> {
  const [row] = await tx<{ day: string | null }[]>`
    select least(
      (select min(happened_on) from movement where user_id = ${userId}),
      (select min(opened_on) from account where user_id = ${userId} and opening_balance <> 0)
    ) as day
  `
  return row?.day ?? null
}

export type BreakdownGroup = 'category' | 'actor' | 'activity' | 'categoryGroup'
/** Which side of the ledger a report reads. Internal transfers are never either. */
export type FlowKind = 'expense' | 'income'

export interface BreakdownRow {
  /**
   * Id of the grouping entity, so a row can link to its filtered movements.
   * A category group has no entity behind it: its own label is its key.
   */
  key: string | null
  label: string | null
  /**
   * What actually left the accounts. On the income side, what came in: no
   * refund is ever linked to an income, so both readings are the same amount
   * there.
   */
  gross: string
  /** Gross minus linked refunds actually received. */
  net: string
  /** How many movements make up the row, so a total can be drilled into. */
  count: string
}

/**
 * Narrows a flow analysis to one activity and/or one category, without
 * touching how its figures are computed: the filter applies to the rows of
 * `flow`, after each movement's share is settled over the whole window. A
 * business activity's income therefore keeps the net it has in the unfiltered
 * reading, and a filtered row is the very row the full ranking shows.
 *
 * Absent selects everything, `null` selects what carries none.
 */
export interface FlowScope {
  activityId?: string | null
  categoryId?: string | null
}

function inScope(tx: Executor, scope: FlowScope) {
  return tx`
    ${scope.activityId === null ? tx`and m.activity_id is null` : scope.activityId ? tx`and m.activity_id = ${scope.activityId}` : tx``}
    ${scope.categoryId === null ? tx`and m.category_id is null` : scope.categoryId ? tx`and m.category_id = ${scope.categoryId}` : tx``}
  `
}

/**
 * Spending (or income) over a period, grouped by category, actor, activity or
 * category group. Both readings are always returned: gross is the reality of
 * outflows, net only diverges once a linked refund has been received.
 *
 * On the income side the counterparty is the source actor, and refunds are
 * excluded outright: a refund is an advance coming back, not money earned, and
 * counting it as income would double-count what `net` already removed from the
 * expense side.
 *
 * A business activity's incomes count net of its charges, and its charges
 * count only for a loss (see `ledger`). By actor or category the rows are its
 * clients and the categories of its incomes, and a charge belongs to none of
 * them: that is why each income keeps its share of what remains rather than
 * one of them bearing the charge. A movement whose share is nothing makes no
 * row and is not counted.
 *
 * Ranked by net, because that is what the period actually cost: ordering by
 * gross would put a line above another it ends up below once the refund is
 * back. Gross breaks the ties, so an equal net still ranks the heavier outflow
 * first and the order stays stable.
 */
export async function spendingBreakdown(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
  scope: FlowScope = {},
): Promise<BreakdownRow[]> {
  const actorColumn = kind === 'expense' ? tx`m.target_actor_id` : tx`m.source_actor_id`
  const entity = tx`left join category g on g.id = m.category_id`
  // A group is a label written on categories, not an entity of its own: it is
  // its own key, and every category carrying it folds into one row. Movements
  // with no category at all fold into that same unlabelled row: both are the
  // mass no group accounts for.
  const dimension = {
    category: { join: entity, key: tx`g.id::text`, label: tx`g.name` },
    actor: { join: tx`left join actor g on g.id = ${actorColumn}`, key: tx`g.id::text`, label: tx`g.name` },
    activity: {
      join: tx`left join activity g on g.id = m.activity_id`,
      key: tx`g.id::text`,
      label: tx`g.name`,
    },
    categoryGroup: { join: entity, key: tx`g.group_label`, label: tx`g.group_label` },
  }[groupBy]
  return await tx<BreakdownRow[]>`
    with ${ledger(tx, userId, from, to, reading)}
    select ${dimension.key} as key,
           ${dimension.label} as label,
           sum(m.amount * m.scale)::numeric(14,2) as gross,
           sum((m.amount - m.refunded) * m.scale)::numeric(14,2) as net,
           count(*) as count
    from flow m
    ${dimension.join}
    where m.side = ${kind} and m.scale > 0 ${inScope(tx, scope)}
    group by 1, 2
    order by net desc, gross desc
  `
}

/** One movement as a flow analysis counts it: its share, net of what came back. */
export interface FlowMovement {
  id: string
  happenedOn: string
  /** The counterparty: who was paid on the expense side, who paid on the income side. */
  actorId: string | null
  actor: string | null
  note: string | null
  gross: string
  net: string
}

/** What the movements left out of a cut list weigh together. */
export interface FlowRest {
  count: string
  gross: string
  net: string
}

/** Where a movement or a rest sits, when the list is cut per category (and activity). */
export interface FlowPlace {
  categoryId: string | null
  activityId: string | null
}

/** The rows a flow analysis can cut its movement list by, each cut on its own. */
export type FlowCut = 'category' | 'activity'

/**
 * The movements behind a row of the analysis, biggest net first, each counted
 * exactly as the row counts it: ghosts left out, linked refunds deducted, a
 * business activity's income for its share of what its charges leave. Their
 * nets add up to the row's net, give or take the rounding of each share to
 * the cent.
 *
 * The list stops at `limit`, and what it leaves out comes back as one rest,
 * so the whole row is still accounted for: the cut happens here rather than in
 * the caller, which would otherwise load a category's entire history to show
 * its biggest few. Cut `per` category (and activity), every one of them keeps
 * its own biggest and its own rest, in one query.
 */
export async function flowMovements(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  kind: FlowKind,
  reading: Reading,
  scope: FlowScope,
  limit: number,
  per: FlowCut[] = [],
): Promise<{ movements: (FlowMovement & FlowPlace)[]; rests: (FlowRest & FlowPlace)[] }> {
  const actorColumn = kind === 'expense' ? tx`m.target_actor_id` : tx`m.source_actor_id`
  const byCategory = per.includes('category')
  const byActivity = per.includes('activity')
  const partition =
    byCategory && byActivity
      ? tx`partition by m.category_id, m.activity_id`
      : byCategory
        ? tx`partition by m.category_id`
        : byActivity
          ? tx`partition by m.activity_id`
          : tx``
  const rows = await tx<(FlowMovement & FlowPlace & { rank: string; restCount: string | null })[]>`
    with ${ledger(tx, userId, from, to, reading)},
    ranked as (
      select m.id, m.happened_on, m.note, g.id as actor_id, g.name as actor,
             ${byCategory ? tx`m.category_id` : tx`null::uuid`} as category_id,
             ${byActivity ? tx`m.activity_id` : tx`null::uuid`} as activity_id,
             m.amount * m.scale as gross,
             (m.amount - m.refunded) * m.scale as net,
             row_number() over (${partition}
                                order by (m.amount - m.refunded) * m.scale desc,
                                         m.amount * m.scale desc, m.happened_on desc, m.id) as rank
      from flow m
      left join actor g on g.id = ${actorColumn}
      where m.side = ${kind} and m.scale > 0 ${inScope(tx, scope)}
    )
    select id::text, happened_on::text, note, actor_id::text, actor,
           category_id::text, activity_id::text,
           gross::numeric(14,2)::text as gross, net::numeric(14,2)::text as net,
           rank, null as rest_count
    from ranked where rank <= ${limit}
    union all
    select null, null, null, null, null, category_id::text, activity_id::text,
           sum(gross)::numeric(14,2)::text, sum(net)::numeric(14,2)::text,
           null, count(*)::text
    from ranked where rank > ${limit}
    group by category_id, activity_id
    order by rank nulls last
  `
  return {
    movements: rows
      .filter((r) => r.restCount === null)
      .map(({ id, happenedOn, actorId, actor, note, gross, net, categoryId, activityId }) => ({
        id,
        happenedOn,
        actorId,
        actor,
        note,
        gross,
        net,
        categoryId,
        activityId,
      })),
    rests: rows
      .filter((r) => r.restCount !== null)
      .map((r) => ({
        count: r.restCount!,
        gross: r.gross,
        net: r.net,
        categoryId: r.categoryId,
        activityId: r.activityId,
      })),
  }
}

export interface FlowTotals {
  /** Expenses as they left the accounts, a business activity's charges only for a loss. */
  expenseGross: string
  /** Expenses minus linked refunds received. */
  expenseNet: string
  /**
   * Money earned: refunds excluded, internal transfers excluded by kind, and
   * a business activity's income net of its charges.
   */
  income: string
  expenseCount: string
  incomeCount: string
}

/**
 * The headline numbers of a period, in one query. Same window semantics as the
 * breakdowns so a total always equals the sum of its rows.
 */
export async function flowTotals(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  reading: Reading = 'cash',
): Promise<FlowTotals> {
  const [row] = await tx<FlowTotals[]>`
    with ${ledger(tx, userId, from, to, reading)}
    select
      coalesce(sum(amount * scale) filter (where side = 'expense'), 0)::numeric(14,2) as expense_gross,
      coalesce(sum((amount - refunded) * scale) filter (where side = 'expense'), 0)::numeric(14,2) as expense_net,
      coalesce(sum(amount * scale) filter (where side = 'income'), 0)::numeric(14,2) as income,
      count(*) filter (where side = 'expense' and scale > 0) as expense_count,
      count(*) filter (where side = 'income' and scale > 0) as income_count
    from flow
  `
  return row!
}

export interface MonthlyFlow {
  /** First day of the month, so it sorts and formats like any other date. */
  month: string
  expenseGross: string
  expenseNet: string
  income: string
}

/**
 * Month-by-month flows over a window, with empty months present at zero: a
 * trend with holes in it reads as a drop, so the series is generated from the
 * calendar rather than from the data.
 *
 * Each month is a window of its own for a business activity's net (see
 * `ledger`): a month that only paid charges shows a loss that the total of a
 * longer period, reading them against what they pay for, does not.
 */
export async function monthlyFlows(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  reading: Reading = 'cash',
): Promise<MonthlyFlow[]> {
  return await tx<MonthlyFlow[]>`
    with months as (
      select generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month')::date as month
    ),
    ${ledger(tx, userId, from, to, reading, true)},
    flows as (
      select window_start as month,
             sum(amount * scale) filter (where side = 'expense') as expense_gross,
             sum((amount - refunded) * scale) filter (where side = 'expense') as expense_net,
             sum(amount * scale) filter (where side = 'income') as income
      from flow
      group by 1
    )
    select ms.month,
           coalesce(f.expense_gross, 0)::numeric(14,2) as expense_gross,
           coalesce(f.expense_net, 0)::numeric(14,2) as expense_net,
           coalesce(f.income, 0)::numeric(14,2) as income
    from months ms
    left join flows f on f.month = ms.month
    order by ms.month
  `
}
