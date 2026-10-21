import type { Exercised } from '@abacus/use-case-language'
import { type Entry, offeringsOf } from '../inventory/index.ts'

/**
 * The guards over the inventory. Each compares it to something real: the
 * interfaces as they are (inventory_out_of_date), the declared drivers
 * (interface_missing_without_reason), and what the drivers really called in a
 * full run (gesture_not_covered, <driver>_tool_not_covered). None knows an
 * interface by name: they read the driver names they are given.
 */

export interface Inventory {
  gestures: Record<string, Entry>
  informations: Record<string, Entry>
}

/** What one interface really has, as its driver names it; `tools`, when the interface is made of tools. */
export interface RealInterface {
  elements: string[]
  tools?: string[]
}

function entries(inventory: Inventory): [kind: string, name: string, entry: Entry][] {
  return [
    ...Object.entries(inventory.gestures).map(
      ([name, entry]) => ['gesture', name, entry] as [string, string, Entry],
    ),
    ...Object.entries(inventory.informations).map(
      ([name, entry]) => ['information', name, entry] as [string, string, Entry],
    ),
  ]
}

function offeredOn(inventory: Inventory, driver: string): Set<string> {
  return new Set(entries(inventory).flatMap(([, , entry]) => offeringsOf(entry, driver)))
}

export function reasonProblems(inventory: Inventory, drivers: string[]): string[] {
  const problems: string[] = []
  for (const [kind, name, entry] of entries(inventory))
    for (const driver of drivers) {
      const offering = entry[driver]
      const given =
        typeof offering === 'string' ||
        (Array.isArray(offering) && offering.length > 0) ||
        (typeof offering === 'object' && 'missingReason' in offering && offering.missingReason.trim() !== '')
      if (!given)
        problems.push(
          `interface_missing_without_reason ${kind} ${name}: ${driver} neither offers it nor says why`,
        )
    }
  return problems
}

export function inventoryProblems(inventory: Inventory, real: Record<string, RealInterface>): string[] {
  const problems: string[] = []
  for (const [driver, { elements }] of Object.entries(real)) {
    const listed = offeredOn(inventory, driver)
    for (const element of elements)
      if (!listed.has(element))
        problems.push(`inventory_out_of_date ${driver} ${element} is in no entry of the inventory`)
    const existing = new Set(elements)
    for (const offering of listed)
      if (!existing.has(offering))
        problems.push(
          `inventory_out_of_date ${driver} ${offering} is in the inventory but the interface has no such thing`,
        )
  }
  return problems
}

/** `screen:/accounts/cards/[cardId]` matches `screen:/accounts/cards/c-1`. */
function matches(offering: string, exercised: string): boolean {
  if (!offering.includes('[')) return offering === exercised
  const pattern = offering.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\\?\[[^\]]+\]/g, '[^/]+')
  return exercised === offering || new RegExp(`^${pattern}$`).test(exercised)
}

export function coverageProblems(
  inventory: Inventory,
  real: Record<string, RealInterface>,
  exercised: Exercised[],
): string[] {
  const problems: string[] = []
  for (const [driver, { tools }] of Object.entries(real)) {
    const called = exercised
      .filter((e) => e.driver === driver)
      .map((e) => (e.action ? `${e.name} · ${e.action}` : e.name))
    for (const offering of offeredOn(inventory, driver))
      if (!called.some((name) => matches(offering, name)))
        problems.push(`gesture_not_covered ${driver} ${offering}`)
    const toolsCalled = new Set(exercised.filter((e) => e.driver === driver).map((e) => e.name))
    for (const tool of tools ?? [])
      if (!toolsCalled.has(tool)) problems.push(`${driver}_tool_not_covered ${tool}`)
  }
  return problems
}
