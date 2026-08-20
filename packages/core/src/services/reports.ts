import { db } from '../db/client.ts'
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

export type { BalancePoint, BreakdownGroup, BreakdownRow, FlowKind, FlowTotals, MonthlyFlow }

export async function spendingBreakdown(
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
  kind: FlowKind = 'expense',
): Promise<BreakdownRow[]> {
  return await spendingBreakdownDs(db(), userId, from, to, groupBy, kind)
}

export async function balanceSeries(userId: string, from: string, to: string): Promise<BalancePoint[]> {
  return await balanceSeriesDs(db(), userId, from, to)
}

export async function flowTotals(userId: string, from: string, to: string): Promise<FlowTotals> {
  return await flowTotalsDs(db(), userId, from, to)
}

export async function monthlyFlows(userId: string, from: string, to: string): Promise<MonthlyFlow[]> {
  return await monthlyFlowsDs(db(), userId, from, to)
}

export async function firstMovementDay(userId: string): Promise<string | null> {
  return await firstMovementDayDs(db(), userId)
}
