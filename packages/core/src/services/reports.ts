import { db } from '../db/client.ts'
import { listCategories as listCategoriesDs } from '../db/datasources/catalog.ts'
import {
  type BalancePoint,
  type BreakdownGroup,
  type BreakdownRow,
  balanceSeries as balanceSeriesDs,
  type FlowKind,
  type FlowTotals,
  firstMovementDay as firstMovementDayDs,
  flowTotals as flowTotalsDs,
  type MonthlyFlow,
  monthlyFlows as monthlyFlowsDs,
  spendingBreakdown as spendingBreakdownDs,
} from '../db/datasources/reports.ts'
import type { Reading } from '../domain/types.ts'

export type { BalancePoint, BreakdownGroup, BreakdownRow, FlowKind, FlowTotals, MonthlyFlow, Reading }

export async function spendingBreakdown(
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
  kind: FlowKind = 'expense',
  reading: Reading = 'cash',
): Promise<BreakdownRow[]> {
  return await spendingBreakdownDs(db(), userId, from, to, groupBy, kind, reading)
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
): Promise<BreakdownMass[]> {
  const [rows, categories] = await Promise.all([
    spendingBreakdownDs(db(), userId, from, to, 'category', kind, reading),
    listCategoriesDs(db(), userId),
  ])
  const groupOf = new Map(categories.map((c) => [c.id, c.groupLabel]))
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
  // Ranked by net like any breakdown, gross breaking the ties; the category
  // rows come out of the datasource already ordered that way.
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

export async function balanceSeries(userId: string, from: string, to: string): Promise<BalancePoint[]> {
  return await balanceSeriesDs(db(), userId, from, to)
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

export async function firstMovementDay(userId: string): Promise<string | null> {
  return await firstMovementDayDs(db(), userId)
}
