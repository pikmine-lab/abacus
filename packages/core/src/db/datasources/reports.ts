import type { Executor } from '../client.ts'

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
 * caller's job — see `firstMovementDay`.
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

export type BreakdownGroup = 'category' | 'actor' | 'activity'
/** Which side of the ledger a report reads. Internal transfers are never either. */
export type FlowKind = 'expense' | 'income'

export interface BreakdownRow {
  /** Id of the grouping entity, so a row can link to its filtered movements. */
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
 * Spending (or income) over a period, grouped by category, actor or activity.
 * Both readings are always returned: gross is the reality of outflows, net only
 * diverges once a linked refund has been received.
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
): Promise<BreakdownRow[]> {
  const actorColumn = kind === 'expense' ? tx`m.target_actor_id` : tx`m.source_actor_id`
  const join = {
    category: tx`left join category g on g.id = m.category_id`,
    actor: tx`left join actor g on g.id = ${actorColumn}`,
    activity: tx`left join activity g on g.id = m.activity_id`,
  }[groupBy]
  return await tx<BreakdownRow[]>`
    select g.id as key,
           g.name as label,
           sum(m.amount)::numeric(14,2) as gross,
           sum(m.amount - coalesce(r.total, 0))::numeric(14,2) as net,
           count(*) as count
    from movement m
    ${join}
    left join lateral (
      select sum(amount) as total from movement r where r.refunds_movement_id = m.id
    ) r on true
    where m.user_id = ${userId}
      and m.kind = ${kind}
      and m.happened_on >= ${from}
      and m.happened_on <= ${to}
      ${kind === 'income' ? tx`and m.refunds_movement_id is null` : tx``}
    group by g.id, g.name
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
      and m.happened_on >= ${from}
      and m.happened_on <= ${to}
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
): Promise<MonthlyFlow[]> {
  return await tx<MonthlyFlow[]>`
    with months as (
      select generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month')::date as month
    ),
    flows as (
      select date_trunc('month', m.happened_on)::date as month,
             sum(m.amount) filter (where m.kind = 'expense') as expense_gross,
             sum(m.amount - coalesce(r.total, 0)) filter (where m.kind = 'expense') as expense_net,
             sum(m.amount) filter (where m.kind = 'income' and m.refunds_movement_id is null) as income
      from movement m
      left join lateral (
        select sum(amount) as total from movement r where r.refunds_movement_id = m.id
      ) r on true
      where m.user_id = ${userId}
        and m.happened_on >= ${from}
        and m.happened_on <= ${to}
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
