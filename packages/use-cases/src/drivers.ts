import { preparationDriver } from '@abacus/core/driver'
import { mcpDriver } from '@abacus/mcp/driver'
import type { Driver } from '@abacus/use-case-language'
import { webDriver } from '@abacus/web/driver'
import { environment } from './environment/index.ts'

/**
 * The drivers every case is played on: one per interface. Adding an interface
 * is adding its driver here and completing the inventory; no case and no
 * guard changes. ABACUS_CASES_DRIVERS=mcp narrows a run to some of them, to go
 * faster while writing a case; the suite in CI always runs them all.
 */
export function drivers(): Driver[] {
  const env = environment()
  const all = [webDriver(env), mcpDriver(env.mcpUrl)]
  const only = process.env.ABACUS_CASES_DRIVERS?.split(',').filter(Boolean)
  return only ? all.filter((d) => only.includes(d.name)) : all
}

export { preparationDriver }
