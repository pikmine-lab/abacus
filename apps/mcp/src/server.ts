import { McpServer } from '@modelcontextprotocol/server'
import { registerBalanceCheckTools } from './tools/balanceChecks.ts'
import { registerCatalogTools } from './tools/catalog.ts'
import { registerCommitmentTools } from './tools/commitments.ts'
import { registerInvestmentTools } from './tools/investments.ts'
import { registerMovementTools } from './tools/movements.ts'
import { registerOverviewTools } from './tools/overview.ts'

/**
 * The files under tools/ ARE the interface. The AI using these tools never
 * sees this repository: tool names, descriptions and error messages are its
 * entire world. Work on them like UI copy, and treat every misuse observed in
 * real sessions as an interface defect to fix there.
 */

const INSTRUCTIONS = `abacus manages the user's personal finances, fully declaratively (no bank connection: the user tells you what happened, you record it).
Model: every movement goes from a source to a target; between two owned accounts it is an internal transfer (neutral, never an expense), to an external actor an expense, from an actor an income. Actors (merchants, clients, organizations) are normalized through aliases: never create a duplicate without checking the suggestions first. Amounts are always positive, in euros. Balance checks (record_balance_check) are the safety net of declarative bookkeeping: suggest one when the latest is older than two weeks. Investment accounts split those two logics: money reaching or leaving them is a movement, what happens inside them (buy, sell, dividend, fee) is an operation (record_investment_operations), and a purchase is never an expense. Start with get_overview when you take over without context.`

export function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: 'abacus', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  registerOverviewTools(server, userId)
  registerMovementTools(server, userId)
  registerBalanceCheckTools(server, userId)
  registerCommitmentTools(server, userId)
  registerCatalogTools(server, userId)
  registerInvestmentTools(server, userId)
  return server
}
