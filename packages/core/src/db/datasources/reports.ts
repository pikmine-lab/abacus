import type { Executor } from '../client.ts'

export interface BalancePoint {
  day: string
  accountId: string
  balance: string
}

/**
 * Daily balance of every open account over a period: the running sum of all
 * movements up to each day. One query; the chart layer does no arithmetic.
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

export type BreakdownGroup = 'category' | 'actor' | 'activity'

export interface BreakdownRow {
  label: string | null
  /** What actually left the accounts. */
  gross: string
  /** Gross minus linked refunds actually received. */
  net: string
}

/**
 * Spending over a period, grouped by category, actor or activity.
 * Both readings are always returned: gross is the reality of outflows,
 * net only diverges once a linked refund has been received.
 */
export async function spendingBreakdown(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
): Promise<BreakdownRow[]> {
  const join = {
    category: tx`left join category g on g.id = m.category_id`,
    actor: tx`left join actor g on g.id = m.target_actor_id`,
    activity: tx`left join activity g on g.id = m.activity_id`,
  }[groupBy]
  return await tx<BreakdownRow[]>`
    select g.name as label,
           sum(m.amount)::numeric(14,2) as gross,
           sum(m.amount - coalesce(r.total, 0))::numeric(14,2) as net
    from movement m
    ${join}
    left join lateral (
      select sum(amount) as total from movement r where r.refunds_movement_id = m.id
    ) r on true
    where m.user_id = ${userId}
      and m.kind = 'expense'
      and m.happened_on >= ${from}
      and m.happened_on <= ${to}
    group by g.name
    order by gross desc
  `
}
