import type {
  Activity,
  ActivityInput,
  DeductibleExpenses,
  Levy,
  LevyModifier,
  RevenueBasis,
  Threshold,
} from '../../domain/types.ts'
import type { Executor } from '../client.ts'

/**
 * The measures a levy rule computes on: named aggregates over an activity, a
 * window and a basis. A rule never reads the ledger itself, it names a measure
 * and a period reference; this file is the only place that knows what each
 * name means in SQL.
 *
 * Two readings of the same year live side by side. On a `cash` basis a receipt
 * counts the day the money arrived, on an `invoiced` basis the day the invoice
 * was issued: that is a property of the regime (activity.revenue_basis), not
 * the app-wide way of counting months, which says nothing fiscal and is never
 * read here.
 *
 * Amounts come back as numbers, unlike every other datasource: what reads them
 * is a pure engine that computes in numbers, so the conversion happens once,
 * here, rather than at every step of a bracket table.
 */

export interface DateRange {
  from: string
  to: string
}

/**
 * Everything the measures need to know about the activity, resolved once: its
 * regime switches and the categories that decide whether an expense reduces
 * the profit.
 */
export interface ActivityScope {
  userId: string
  activityId: string
  /** The accounts the activity lives on: its treasury is their balance. */
  accountIds: string[]
  /** Those of them another activity also lives on. */
  sharedAccountIds: string[]
  basis: RevenueBasis
  vatRegistered: boolean
  deductibleExpenses: DeductibleExpenses
  /** Categories that go against the deductibility policy (activity_category_exception). */
  exceptionCategoryIds: string[]
  /** Settlement categories of the rules whose payment reduces the profit. */
  deductibleSettlementCategoryIds: string[]
  /** Settlement categories of the rules whose payment does not: an income tax, a pass-through. */
  excludedSettlementCategoryIds: string[]
}

/**
 * Reads the activity's own switches, the accounts it lives on and the
 * categories its rules settle in. A rule says explicitly whether paying it
 * reduces the profit, so its settlement category decides before the activity's
 * policy does: a pass-through (VAT collected for the state) and a
 * non-deductible tax leave the charges whatever the policy, and a deductible
 * contribution enters them even under a flat-rate regime that deducts nothing
 * else.
 */
export async function activityScope(
  tx: Executor,
  userId: string,
  activity: Activity,
): Promise<ActivityScope> {
  const exceptions = await tx<{ categoryId: string }[]>`
    select category_id from activity_category_exception where activity_id = ${activity.id}
  `
  const accounts = await tx<{ accountId: string; shared: boolean }[]>`
    select l.account_id,
           (select count(*) from activity_account o where o.account_id = l.account_id) > 1 as shared
    from activity_account l
    where l.activity_id = ${activity.id}
  `
  const settlements = await tx<{ categoryId: string; deductible: boolean; passThrough: boolean }[]>`
    select distinct settlement_category_id as category_id, deductible, pass_through
    from levy
    where user_id = ${userId} and activity_id = ${activity.id} and settlement_category_id is not null
  `
  return {
    userId,
    activityId: activity.id,
    accountIds: accounts.map((a) => a.accountId),
    sharedAccountIds: accounts.filter((a) => a.shared).map((a) => a.accountId),
    basis: activity.revenueBasis,
    vatRegistered: activity.vatRegistered,
    deductibleExpenses: activity.deductibleExpenses,
    exceptionCategoryIds: exceptions.map((e) => e.categoryId),
    deductibleSettlementCategoryIds: settlements
      .filter((s) => s.deductible && !s.passThrough)
      .map((s) => s.categoryId),
    excludedSettlementCategoryIds: settlements
      .filter((s) => !s.deductible || s.passThrough)
      .map((s) => s.categoryId),
  }
}

/**
 * Which expenses reduce the profit. `all` counts every expense of the
 * activity except its exceptions; `none` counts only what the exceptions name.
 * A rule's settlement category overrides both, in the direction the rule
 * states.
 */
function deductibleExpenseClause(tx: Executor, scope: ActivityScope) {
  const excluded = scope.excludedSettlementCategoryIds
  if (scope.deductibleExpenses === 'all') {
    const out = [...new Set([...excluded, ...scope.exceptionCategoryIds])].filter(
      (id) => !scope.deductibleSettlementCategoryIds.includes(id),
    )
    return tx`and (m.category_id is null or m.category_id::text <> all(${out}::text[]))`
  }
  const inside = [
    ...new Set([...scope.exceptionCategoryIds, ...scope.deductibleSettlementCategoryIds]),
  ].filter((id) => !excluded.includes(id))
  return tx`and m.category_id::text = any(${inside}::text[])`
}

/** An expense without the VAT the activity reclaims; the whole amount when it reclaims none. */
function netOfVat(tx: Executor, scope: ActivityScope) {
  return scope.vatRegistered ? tx`m.amount - coalesce(m.vat_amount, 0)` : tx`m.amount`
}

/** Every expense of the activity except the levy settlements, which are never a charge of their own. */
function activityExpenseClause(tx: Executor, scope: ActivityScope) {
  const settlements = [...scope.excludedSettlementCategoryIds, ...scope.deductibleSettlementCategoryIds]
  return tx`and (m.category_id is null or m.category_id::text <> all(${settlements}::text[]))`
}

export interface Measures {
  /** Revenue before VAT, in the basis asked for. */
  revenue: number
  /** The same receipts with the VAT they bore. */
  revenueInclVat: number
  /** Deductible expenses, before VAT when the activity reclaims it. */
  expenses: number
  /** `revenue − expenses`, before any allowance a rule takes on it. */
  profit: number
  vatCollected: number
  vatDeductible: number
  /** `vatCollected − vatDeductible`, what a VAT return owes. */
  vatBalance: number
  /** What clients kept back and paid to the tax office in the user's name. */
  withholdings: number
}

/**
 * Revenue and the VAT collected on it, in one reading.
 *
 * On the `cash` side an income that pays an invoice carries the invoice's
 * split, pro rata of what the payment covers of the receivable: a client
 * paying half of a net that a withholding already shrank brings half of the
 * base and half of the VAT, never the whole invoice and never the bare
 * transfer. An income that pays no invoice is its amount less the VAT stated
 * on it. On the `invoiced` side the invoice is the fact: its base and its VAT
 * count on the day it was issued, whatever the bank did afterwards, and a
 * cancelled invoice counts nowhere.
 */
async function receipts(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
  basis: RevenueBasis,
): Promise<{ revenue: number; revenueInclVat: number; vatCollected: number; withholdings: number }> {
  if (basis === 'invoiced') {
    const [row] = await tx<{ base: string; total: string; vat: string; withholding: string }[]>`
      select coalesce(sum(base_amount), 0) as base,
             coalesce(sum(total_amount), 0) as total,
             coalesce(sum(vat_amount), 0) as vat,
             coalesce(sum(withholding_amount), 0) as withholding
      from invoice
      where user_id = ${scope.userId} and activity_id = ${scope.activityId}
        and cancelled_on is null
        and issued_on >= ${range.from} and issued_on <= ${range.to}
    `
    return {
      revenue: Number(row!.base),
      revenueInclVat: Number(row!.total),
      vatCollected: Number(row!.vat),
      withholdings: Number(row!.withholding),
    }
  }
  const [row] = await tx<{ base: string; total: string; vat: string; withholding: string }[]>`
    select
      coalesce(sum(case when i.id is not null then m.amount * i.base_amount / i.receivable_amount
                        else m.amount - coalesce(m.vat_amount, 0) end), 0) as base,
      coalesce(sum(case when i.id is not null then m.amount * i.total_amount / i.receivable_amount
                        else m.amount end), 0) as total,
      coalesce(sum(case when i.id is not null then m.amount * i.vat_amount / i.receivable_amount
                        else coalesce(m.vat_amount, 0) end), 0) as vat,
      coalesce(sum(case when i.id is not null then m.amount * i.withholding_amount / i.receivable_amount
                        else 0 end), 0) as withholding
    from movement m
    left join invoice i
      on i.id = m.invoice_id and i.cancelled_on is null and i.receivable_amount > 0
    where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
      and m.kind = 'income' and m.ghost = false and m.refunds_movement_id is null
      and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
  `
  return {
    revenue: Number(row!.base),
    revenueInclVat: Number(row!.total),
    vatCollected: Number(row!.vat),
    withholdings: Number(row!.withholding),
  }
}

/**
 * Charges and the VAT they bore. Both are always read on the day the money
 * left: an expense has no other date, since abacus records what was paid and
 * not the supplier invoice behind it.
 *
 * The VAT reclaimed is read on every expense of the activity, not only the
 * deductible ones: a purchase a flat-rate regime refuses as a charge still
 * bears a VAT that a registered activity reclaims, and the two questions are
 * not the same one.
 */
async function charges(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
): Promise<{ expenses: number; vatDeductible: number }> {
  const [row] = await tx<{ expenses: string; vat: string }[]>`
    select
      coalesce(sum(${netOfVat(tx, scope)})
               filter (where true ${deductibleExpenseClause(tx, scope)}), 0) as expenses,
      coalesce(sum(coalesce(m.vat_amount, 0))
               filter (where true ${activityExpenseClause(tx, scope)}), 0) as vat
    from movement m
    where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
      and m.kind = 'expense' and m.ghost = false
      and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
  `
  return { expenses: Number(row!.expenses), vatDeductible: scope.vatRegistered ? Number(row!.vat) : 0 }
}

/** Every measure of one window, in the basis asked for (the regime's by default). */
export async function readMeasures(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
  basis: RevenueBasis = scope.basis,
): Promise<Measures> {
  const [received, paid] = await Promise.all([receipts(tx, scope, range, basis), charges(tx, scope, range)])
  const vatBalance = received.vatCollected - paid.vatDeductible
  return {
    revenue: received.revenue,
    revenueInclVat: received.revenueInclVat,
    expenses: paid.expenses,
    profit: received.revenue - paid.expenses,
    vatCollected: received.vatCollected,
    vatDeductible: paid.vatDeductible,
    vatBalance,
    withholdings: received.withholdings,
  }
}

/** Revenue alone, for the second reading a statement shows beside the regime's. */
export async function readRevenue(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
  basis: RevenueBasis,
): Promise<number> {
  return (await receipts(tx, scope, range, basis)).revenue
}

export interface Settlement {
  categoryId: string
  happenedOn: string
  amount: number
  movementId: string
}

/**
 * What was really paid against the rules: the activity's expenses filed in
 * their settlement categories. Always by the day the money left, whatever the
 * regime's basis: a payment has no other date.
 *
 * The rows come back one by one rather than summed, because the schedule has
 * to know which window each payment falls in, and the reserve has to sum them
 * from the start of the year.
 */
export async function levySettlements(
  tx: Executor,
  scope: ActivityScope,
  categoryIds: string[],
  range: DateRange,
): Promise<Settlement[]> {
  if (categoryIds.length === 0) return []
  const rows = await tx<{ categoryId: string; happenedOn: string; amount: string; movementId: string }[]>`
    select m.category_id, m.happened_on, m.amount, m.id as movement_id
    from movement m
    where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
      and m.kind = 'expense' and m.ghost = false
      and m.category_id::text = any(${categoryIds}::text[])
      and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
    order by m.happened_on
  `
  return rows.map((r) => ({
    categoryId: r.categoryId,
    happenedOn: r.happenedOn,
    amount: Number(r.amount),
    movementId: r.movementId,
  }))
}

/** One account of the treasury, and the other activities living on it. */
export interface TreasuryAccount {
  id: string
  name: string
  balance: number
  /** The other activities this account also carries, by name; empty when it is the activity's alone. */
  sharedWith: string[]
}

/**
 * The money the activity holds on a day, account by account: the balance of
 * the accounts it lives on, read exactly as any balance is (what they held
 * before the ledger began, plus what moved, plus what the cash of an
 * investment account did). A ghost movement counts here, as it counts in every
 * balance: it did touch the account.
 *
 * A shared account counts whole, and it says with whom. Nothing is
 * apportioned: what the other activities owe is taken off further down, once,
 * where the payable is computed.
 */
export async function treasuryAccounts(
  tx: Executor,
  scope: ActivityScope,
  on: string,
): Promise<TreasuryAccount[]> {
  return await tx<TreasuryAccount[]>`
    select a.id, a.name,
      (case when a.opened_on is null or a.opened_on <= ${on} then a.opening_balance else 0 end
      + coalesce((
        select sum(case when m.target_account_id = a.id then m.amount else -m.amount end)
        from movement m
        where (m.source_account_id = a.id or m.target_account_id = a.id) and m.happened_on <= ${on}
      ), 0)
      + coalesce((
        select sum(case when o.type in ('sell', 'dividend') then o.amount else -o.amount end)
        from investment_operation o
        where o.account_id = a.id and o.operated_on <= ${on}
      ), 0))::numeric(14,2)::float8 as balance,
      coalesce((
        select array_agg(other.name order by other.name)
        from activity_account l
        join activity other on other.id = l.activity_id
        where l.account_id = a.id and l.activity_id <> ${scope.activityId}
      ), '{}'::text[]) as shared_with
    from account a
    where a.user_id = ${scope.userId} and a.id::text = any(${scope.accountIds}::text[])
    order by a.name
  `
}

/**
 * What the owner took out of the activity: transfers from one of the accounts
 * it lives on to an account it does not live on. That is the only definition
 * this question ever gets, and it is why an activity declares its accounts.
 *
 * Out of a shared account, only a movement naming the activity counts for it.
 * A transfer inherits no activity from its accounts, so an untagged one says
 * nothing about which of the activities on that account the money left, and
 * counting it for each would show the same euro paid out twice.
 */
export async function paidToSelf(tx: Executor, scope: ActivityScope, range: DateRange): Promise<number> {
  const [row] = await tx<{ total: string }[]>`
    select coalesce(sum(m.amount), 0)::numeric(14,2) as total
    from movement m
    where m.user_id = ${scope.userId}
      and m.source_account_id::text = any(${scope.accountIds}::text[])
      and m.target_account_id is not null
      and m.target_account_id::text <> all(${scope.accountIds}::text[])
      and (m.source_account_id::text <> all(${scope.sharedAccountIds}::text[])
           or m.activity_id = ${scope.activityId})
      and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
  `
  return Number(row!.total)
}

export interface NamedTotal {
  key: string | null
  label: string | null
  amount: number
}

/**
 * Revenue by client, in the regime's basis: the clients an invoice names, or
 * the actors the incomes came from when nothing was invoiced.
 */
export async function revenueByClient(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
  basis: RevenueBasis = scope.basis,
): Promise<NamedTotal[]> {
  const rows =
    basis === 'invoiced'
      ? await tx<{ key: string | null; label: string | null; amount: string }[]>`
          select a.id::text as key, a.name as label, sum(i.base_amount)::numeric(14,2) as amount
          from invoice i
          join actor a on a.id = i.actor_id
          where i.user_id = ${scope.userId} and i.activity_id = ${scope.activityId}
            and i.cancelled_on is null
            and i.issued_on >= ${range.from} and i.issued_on <= ${range.to}
          group by 1, 2
          order by amount desc
        `
      : await tx<{ key: string | null; label: string | null; amount: string }[]>`
          select a.id::text as key, a.name as label,
                 sum(case when i.id is not null then m.amount * i.base_amount / i.receivable_amount
                          else m.amount - coalesce(m.vat_amount, 0) end)::numeric(14,2) as amount
          from movement m
          left join actor a on a.id = m.source_actor_id
          left join invoice i
            on i.id = m.invoice_id and i.cancelled_on is null and i.receivable_amount > 0
          where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
            and m.kind = 'income' and m.ghost = false and m.refunds_movement_id is null
            and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
          group by 1, 2
          order by amount desc
        `
  return rows.map((r) => ({ key: r.key, label: r.label, amount: Number(r.amount) }))
}

export interface CategoryTotal extends NamedTotal {
  /** True when this category settles a rule: a payment against a provision, not a charge of its own. */
  settlesLevy: boolean
}

/** Charges by category, the settlements of rules kept apart from the rest. */
export async function expensesByCategory(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
): Promise<CategoryTotal[]> {
  const rows = await tx<{ key: string | null; label: string | null; amount: string }[]>`
    select c.id::text as key, c.name as label,
           sum(${netOfVat(tx, scope)})::numeric(14,2) as amount
    from movement m
    left join category c on c.id = m.category_id
    where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
      and m.kind = 'expense' and m.ghost = false
      and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
    group by 1, 2
    order by amount desc
  `
  const settling = new Set([...scope.excludedSettlementCategoryIds, ...scope.deductibleSettlementCategoryIds])
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    amount: Number(r.amount),
    settlesLevy: r.key !== null && settling.has(r.key),
  }))
}

// ---------------------------------------------------------------------------
// The rules themselves
// ---------------------------------------------------------------------------

/**
 * The rules of an activity in force on a day: a rate that changed is a new row
 * with its own validity, so reading a closed year still reads what that year
 * was computed with.
 */
export async function listLevies(
  tx: Executor,
  userId: string,
  activityId: string,
  on?: string,
): Promise<Levy[]> {
  return await tx<Levy[]>`
    select * from levy
    where user_id = ${userId} and activity_id = ${activityId}
    ${on ? tx`and valid_from <= ${on} and (valid_to is null or valid_to >= ${on})` : tx``}
    order by kind, name, valid_from
  `
}

/**
 * The rules that were in force at any point of a window. A year is read rule
 * by rule and period by period, and a rate replaced on 1 January leaves two
 * rows covering the same year.
 */
export async function listLeviesOverlapping(
  tx: Executor,
  userId: string,
  activityId: string,
  range: DateRange,
): Promise<Levy[]> {
  return await tx<Levy[]>`
    select * from levy
    where user_id = ${userId} and activity_id = ${activityId}
      and valid_from <= ${range.to} and (valid_to is null or valid_to >= ${range.from})
    order by kind, name, valid_from
  `
}

export async function listLevyModifiers(tx: Executor, levyIds: string[]): Promise<LevyModifier[]> {
  if (levyIds.length === 0) return []
  return await tx<LevyModifier[]>`
    select * from levy_modifier where levy_id::text = any(${levyIds}::text[]) order by label
  `
}

export async function listActivityInputs(
  tx: Executor,
  userId: string,
  activityId: string,
): Promise<ActivityInput[]> {
  return await tx<ActivityInput[]>`
    select * from activity_input
    where user_id = ${userId} and activity_id = ${activityId}
    order by name, valid_from
  `
}

export async function listThresholds(tx: Executor, userId: string, activityId: string): Promise<Threshold[]> {
  return await tx<Threshold[]>`
    select * from threshold where user_id = ${userId} and activity_id = ${activityId} order by label
  `
}

/**
 * The share of the revenue that bore a withholding, as a percentage. Several
 * regimes hang an exemption on it ("no instalment when clients withheld on at
 * least 70 % of the receipts"), so it is a measure a threshold watches.
 */
export async function withholdingShare(
  tx: Executor,
  scope: ActivityScope,
  range: DateRange,
  basis: RevenueBasis = scope.basis,
): Promise<number> {
  const [row] =
    basis === 'invoiced'
      ? await tx<{ withheld: string; total: string }[]>`
          select coalesce(sum(base_amount) filter (where withholding_amount > 0), 0) as withheld,
                 coalesce(sum(base_amount), 0) as total
          from invoice
          where user_id = ${scope.userId} and activity_id = ${scope.activityId}
            and cancelled_on is null
            and issued_on >= ${range.from} and issued_on <= ${range.to}
        `
      : await tx<{ withheld: string; total: string }[]>`
          select
            coalesce(sum(m.amount * i.base_amount / i.receivable_amount)
                     filter (where i.withholding_amount > 0), 0) as withheld,
            coalesce(sum(case when i.id is not null then m.amount * i.base_amount / i.receivable_amount
                              else m.amount - coalesce(m.vat_amount, 0) end), 0) as total
          from movement m
          left join invoice i
            on i.id = m.invoice_id and i.cancelled_on is null and i.receivable_amount > 0
          where m.user_id = ${scope.userId} and m.activity_id = ${scope.activityId}
            and m.kind = 'income' and m.ghost = false and m.refunds_movement_id is null
            and m.happened_on >= ${range.from} and m.happened_on <= ${range.to}
        `
  const total = Number(row!.total)
  return total === 0 ? 0 : (Number(row!.withheld) / total) * 100
}
