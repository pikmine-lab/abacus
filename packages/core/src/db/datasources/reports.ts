import type { Executor } from '../client.ts'

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
