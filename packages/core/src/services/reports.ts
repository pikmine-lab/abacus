import { db } from '../db/client.ts'
import { listCategories as listCategoriesDs } from '../db/datasources/catalog.ts'
import {
  type BalancePoint,
  type BreakdownGroup,
  type BreakdownRow,
  balanceSeries as balanceSeriesDs,
  categoriesWithin as categoriesWithinDs,
  type FlowCut,
  type FlowKind,
  type FlowMovement,
  type FlowPlace,
  type FlowRest,
  type FlowScope,
  type FlowTotals,
  firstDeclaredDay as firstDeclaredDayDs,
  flowMovements as flowMovementsDs,
  flowTotals as flowTotalsDs,
  type MonthlyFlow,
  monthlyFlows as monthlyFlowsDs,
  spendingBreakdown as spendingBreakdownDs,
  type WithinRow,
} from '../db/datasources/reports.ts'
import type { Reading } from '../domain/types.ts'

export type {
  BalancePoint,
  BreakdownGroup,
  BreakdownRow,
  FlowCut,
  FlowKind,
  FlowMovement,
  FlowPlace,
  FlowRest,
  FlowScope,
  FlowTotals,
  MonthlyFlow,
  Reading,
}

export async function spendingBreakdown(
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
  scope: FlowScope = {},
): Promise<BreakdownRow[]> {
  return await spendingBreakdownDs(db(), userId, from, to, groupBy, kind, reading, scope)
}

/**
 * One mass and the category rows that make it. A group has no entity behind
 * it, so drilling into it means showing what it merges rather than following a
 * link.
 */
export interface BreakdownMass extends BreakdownRow {
  categories: BreakdownRow[]
}

/**
 * Spending (or income) folded into category groups, each group keeping the
 * categories it merges. The fold lives here rather than in SQL: a group is a
 * label written on categories, so the category breakdown and those labels
 * already hold the answer, and a group total stays the sum of the very rows
 * shown under it.
 *
 * A category carrying no group and a movement carrying no category share one
 * row, the mass no group accounts for, exactly as the `categoryGroup`
 * breakdown does.
 */
export async function spendingByCategoryGroup(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
  scope: FlowScope = {},
): Promise<BreakdownMass[]> {
  const [rows, categories] = await Promise.all([
    spendingBreakdownDs(db(), userId, from, to, 'category', kind, reading, scope),
    listCategoriesDs(db(), userId),
  ])
  return foldGroups(rows, new Map(categories.map((c) => [c.id, c.groupLabel])))
}

/**
 * Spending (or income) by actor, each actor keeping the categories it was paid
 * for (or paid for), so an actor can be unfolded the way a group is. An actor
 * is the very row the ranking by actor shows; the categories under it are each
 * rounded to the cent on their own.
 */
export async function spendingByActor(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
): Promise<BreakdownMass[]> {
  const [actors, rows] = await Promise.all([
    spendingBreakdownDs(db(), userId, from, to, 'actor', kind, reading),
    categoriesWithinDs(db(), userId, from, to, 'actor', kind, reading),
  ])
  const within = byWithin(rows)
  return actors.map((a) => ({ ...a, categories: within.get(a.key) ?? [] }))
}

/** An activity, and its spending (or income) folded into category groups. */
export interface ActivityMass extends BreakdownRow {
  groups: BreakdownMass[]
}

/**
 * Spending (or income) by activity, each activity unfolding into its category
 * groups and their categories. An activity is the very row the ranking by
 * activity shows, and its groups are the ones `spendingByCategoryGroup` gives
 * narrowed to it, read for every activity at once.
 */
export async function spendingByActivity(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
): Promise<ActivityMass[]> {
  const [activities, rows, categories] = await Promise.all([
    spendingBreakdownDs(db(), userId, from, to, 'activity', kind, reading),
    categoriesWithinDs(db(), userId, from, to, 'activity', kind, reading),
    listCategoriesDs(db(), userId),
  ])
  const within = byWithin(rows)
  const groupOf = new Map(categories.map((c) => [c.id, c.groupLabel]))
  return activities.map((a) => ({ ...a, groups: foldGroups(within.get(a.key) ?? [], groupOf) }))
}

/** The category rows of each actor or activity, in the order they came. */
function byWithin(rows: WithinRow[]): Map<string | null, BreakdownRow[]> {
  const within = new Map<string | null, BreakdownRow[]>()
  for (const { withinKey, withinLabel: _, ...row } of rows)
    within.set(withinKey, [...(within.get(withinKey) ?? []), row])
  return within
}

/**
 * Category rows folded into the groups they carry, each group summing its
 * rows. Ranked by net like any breakdown, gross breaking the ties; the rows
 * keep the order they came in, which the datasource already ranks that way.
 */
function foldGroups(rows: BreakdownRow[], groupOf: Map<string, string | null>): BreakdownMass[] {
  const masses = new Map<string | null, { gross: number; net: number; count: number; rows: BreakdownRow[] }>()
  for (const row of rows) {
    const group = row.key ? (groupOf.get(row.key) ?? null) : null
    const mass = masses.get(group) ?? { gross: 0, net: 0, count: 0, rows: [] }
    mass.gross += Number(row.gross)
    mass.net += Number(row.net)
    mass.count += Number(row.count)
    mass.rows.push(row)
    masses.set(group, mass)
  }
  return [...masses]
    .map(([group, mass]) => ({
      key: group,
      label: group,
      gross: mass.gross.toFixed(2),
      net: mass.net.toFixed(2),
      count: String(mass.count),
      categories: mass.rows,
    }))
    .sort((a, b) => Number(b.net) - Number(a.net) || Number(b.gross) - Number(a.gross))
}

/**
 * The movements that make one row of the analysis, biggest first and counted
 * as the row counts them, so that drilling from a total down to what explains
 * it never changes the figures on the way. Past `limit`, the rest comes back
 * as one sum.
 */
export async function flowMovements(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind,
  reading: Reading,
  scope: FlowScope,
  limit: number,
): Promise<{ movements: FlowMovement[]; rest: FlowRest | null }> {
  const { movements, rests } = await flowMovementsDs(db(), userId, from, to, kind, reading, scope, limit)
  // Uncut, every row sits nowhere in particular: the place says nothing.
  const [rest] = rests
  return {
    movements: movements.map(({ categoryId: _c, activityId: _a, ...m }) => m),
    rest: rest ? { count: rest.count, gross: rest.gross, net: rest.net } : null,
  }
}

/**
 * Every movement of the period at once, the biggest `limit` of each category
 * (of each category within each activity or actor, `per` it too) and the rest
 * of each as one sum: what a reading that zooms anywhere needs, bounded however
 * long the period.
 */
export async function flowLeaves(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind,
  reading: Reading,
  limit: number,
  per: FlowCut[],
): Promise<{ movements: (FlowMovement & FlowPlace)[]; rests: (FlowRest & FlowPlace)[] }> {
  return await flowMovementsDs(db(), userId, from, to, kind, reading, {}, limit, per)
}

export async function balanceSeries(
  userId: string,
  from: string,
  to: string,
  accountId?: string,
): Promise<BalancePoint[]> {
  return await balanceSeriesDs(db(), userId, from, to, accountId)
}

export async function flowTotals(
  userId: string,
  from: string,
  to: string,
  reading: Reading = 'cash',
): Promise<FlowTotals> {
  return await flowTotalsDs(db(), userId, from, to, reading)
}

export async function monthlyFlows(
  userId: string,
  from: string,
  to: string,
  reading: Reading = 'cash',
): Promise<MonthlyFlow[]> {
  return await monthlyFlowsDs(db(), userId, from, to, reading)
}

export async function firstDeclaredDay(userId: string): Promise<string | null> {
  return await firstDeclaredDayDs(db(), userId)
}
