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
