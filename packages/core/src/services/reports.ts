import { db } from '../db/client.ts'
import {
  type BalancePoint,
  type BreakdownGroup,
  type BreakdownRow,
  balanceSeries as balanceSeriesDs,
  spendingBreakdown as spendingBreakdownDs,
} from '../db/datasources/reports.ts'

export type { BalancePoint, BreakdownGroup, BreakdownRow }

export async function spendingBreakdown(
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
): Promise<BreakdownRow[]> {
  return await spendingBreakdownDs(db(), userId, from, to, groupBy)
}

export async function balanceSeries(userId: string, from: string, to: string): Promise<BalancePoint[]> {
  return await balanceSeriesDs(db(), userId, from, to)
}
