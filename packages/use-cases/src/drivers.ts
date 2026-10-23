import { preparationDriver as preparationOf } from '@abacus/core/driver'
import { mcpDriver, mcpSurface } from '@abacus/mcp/driver'
import type { Driver } from '@abacus/use-case-language'
import { webDriver, webSurface } from '@abacus/web/driver'
import { type Environment, environment } from './environment/index.ts'
import type { RealInterface } from './guards/inventory.ts'

/**
 * The drivers every case is played on: one per interface, each with what its
 * interface offers, for the inventory guards. Adding an interface is adding
 * its driver here and completing the inventory; no case and no guard changes.
 * ABACUS_CASES_DRIVERS=mcp narrows a run to some of them, to go faster while
 * writing a case; the suite in CI always runs them all.
 */
export const DECLARED: {
  name: string
  make(env: Environment): Driver
  surface(): Promise<RealInterface> | RealInterface
}[] = [
  { name: 'web', make: (env) => webDriver(env), surface: webSurface },
  { name: 'mcp', make: (env) => mcpDriver(env), surface: mcpSurface },
]

export function driverNames(): string[] {
  return DECLARED.map((d) => d.name)
}

export function drivers(): Driver[] {
  const env = environment()
  const only = process.env.ABACUS_CASES_DRIVERS?.split(',').filter(Boolean)
  return DECLARED.filter((d) => !only || only.includes(d.name)).map((d) => d.make(env))
}

let preparation: Driver | undefined

/** The driver that builds each case's starting state through the back, on the same configuration. */
export function preparationDriver(): Driver {
  preparation ??= preparationOf(environment())
  return preparation
}
