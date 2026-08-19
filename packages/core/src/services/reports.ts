import { db } from '../db/client.ts'
import {
  spendingBreakdown as spendingBreakdownDs,
  type BreakdownGroup,
  type BreakdownRow,
} from '../db/datasources/reports.ts'

export type { BreakdownGroup, BreakdownRow }

export async function spendingBreakdown(
  userId: string,
  from: string,
  to: string,
  groupBy: BreakdownGroup,
): Promise<BreakdownRow[]> {
  return await spendingBreakdownDs(db(), userId, from, to, groupBy)
}
