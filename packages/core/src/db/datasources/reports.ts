import type { Reading } from '../../domain/types.ts'
import type { Executor } from '../client.ts'

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

export interface BalancePoint {
  day: string
  accountId: string
  balance: string
}

/**
 * Daily balance of every open account over a period: the running sum of all
 * movements up to each day. One query; the chart layer does no arithmetic.
 *
 * The window is honoured exactly as asked, days before the first movement
 * included (they are legitimately zero). Choosing a sensible `from` is the
 * caller's job: see `firstMovementDay`.
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
      from (
        select source_account_id as account_id, happened_on, -amount as delta
        from movement where user_id = ${userId} and source_account_id is not null
        union all
        select target_account_id, happened_on, amount
        from movement where user_id = ${userId} and target_account_id is not null
      ) f
      group by f.account_id, f.happened_on
    )
    select d.day, a.id as account_id,
           coalesce(sum(fl.delta) filter (where fl.happened_on <= d.day), 0)::numeric(14,2) as balance
    from days d
    cross join account a
    left join flows fl on fl.account_id = a.id
    where a.user_id = ${userId} and a.closed_on is null
    group by d.day, a.id
    order by d.day
  `
}

/**
 * Day of the earliest declared movement, or null when nothing is declared.
 * Views that offer an open-ended period ("everything") clamp their window to
 * it, so a series does not start at the epoch.
 */
export async function firstMovementDay(tx: Executor, userId: string): Promise<string | null> {
  const [row] = await tx<{ day: string | null }[]>`
    select min(happened_on) as day from movement where user_id = ${userId}
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
  /** What actually left the accounts. */
  gross: string
  /** Gross minus linked refunds actually received. */
  net: string
  /** How many movements make up the row, so a total can be drilled into. */
  count: string
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
 */
export async function spendingBreakdown(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
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
    select ${dimension.key} as key,
           ${dimension.label} as label,
           sum(m.amount)::numeric(14,2) as gross,
           sum(m.amount - coalesce(r.total, 0))::numeric(14,2) as net,
           count(*) as count
    from movement m
    ${dimension.join}
    left join lateral (
      select sum(amount) as total from movement r where r.refunds_movement_id = m.id
    ) r on true
    where m.user_id = ${userId}
      and m.kind = ${kind}
      ${inPeriod(tx, from, to, reading)}
      ${kind === 'income' ? tx`and m.refunds_movement_id is null` : tx``}
    group by 1, 2
    order by gross desc
  `
}

export interface FlowTotals {
  /** Expenses as they left the accounts. */
  expenseGross: string
  /** Expenses minus linked refunds received. */
  expenseNet: string
  /** Money earned: refunds excluded, internal transfers excluded by kind. */
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
    select
      coalesce(sum(m.amount) filter (where m.kind = 'expense'), 0)::numeric(14,2) as expense_gross,
      coalesce(sum(m.amount - coalesce(r.total, 0)) filter (where m.kind = 'expense'), 0)::numeric(14,2) as expense_net,
      coalesce(sum(m.amount) filter (where m.kind = 'income' and m.refunds_movement_id is null), 0)::numeric(14,2) as income,
      count(*) filter (where m.kind = 'expense') as expense_count,
      count(*) filter (where m.kind = 'income' and m.refunds_movement_id is null) as income_count
    from movement m
    left join lateral (
      select sum(amount) as total from movement r where r.refunds_movement_id = m.id
    ) r on true
    where m.user_id = ${userId}
      ${inPeriod(tx, from, to, reading)}
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
 */
export async function monthlyFlows(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  reading: Reading = 'cash',
): Promise<MonthlyFlow[]> {
  const month = reading === 'accrual' ? tx`m.counted_in_month` : tx`date_trunc('month', m.happened_on)::date`
  return await tx<MonthlyFlow[]>`
    with months as (
      select generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month')::date as month
    ),
    flows as (
      select ${month} as month,
             sum(m.amount) filter (where m.kind = 'expense') as expense_gross,
             sum(m.amount - coalesce(r.total, 0)) filter (where m.kind = 'expense') as expense_net,
             sum(m.amount) filter (where m.kind = 'income' and m.refunds_movement_id is null) as income
      from movement m
      left join lateral (
        select sum(amount) as total from movement r where r.refunds_movement_id = m.id
      ) r on true
      where m.user_id = ${userId}
        ${inPeriod(tx, from, to, reading)}
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
