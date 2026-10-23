import { DECLARED } from '../drivers.ts'
import type { RealInterface } from './inventory.ts'

/** What each declared interface really offers, as its driver describes it. */
export async function realInterfaces(): Promise<Record<string, RealInterface>> {
  return Object.fromEntries(
    await Promise.all(DECLARED.map(async (d) => [d.name, await d.surface()] as const)),
  )
}
