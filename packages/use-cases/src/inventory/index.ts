/**
 * What each interface offers: every gesture (at the action level) and every
 * information (at the data level), and for each declared interface what offers
 * it, or why that interface does not. Interfaces are not written in by hand
 * anywhere else: an entry is keyed by the name of the driver that plays it.
 *
 * What offers a gesture is named as the driver notes it when it exercises it:
 * a web server action or `screen:<path>`, an MCP tool or `tool · action`.
 */

export interface Missing {
  missingReason: string
}

export type Offering = string | string[] | Missing

export type Entry = Record<string, Offering>

const PROTOCOL =
  'An OAuth sign-in and consent are web pages by construction of the protocol: an MCP client opens them in the browser.'

export const gestures: Record<string, Entry> = {
  'auth.sign-up': { web: 'screen:/login', mcp: { missingReason: PROTOCOL } },
  'auth.sign-in': { web: 'screen:/login', mcp: { missingReason: PROTOCOL } },
  'auth.sign-out': { web: 'screen:/', mcp: { missingReason: PROTOCOL } },
  'auth.consent': { web: 'screen:/consent', mcp: { missingReason: PROTOCOL } },
}

export const informations: Record<string, Entry> = {}

/** Whether a driver's interface offers an entry: false only when the inventory gives it a reason. */
export function offers(entry: Entry | undefined, driver: string): boolean {
  const offering = entry?.[driver]
  return !(offering && typeof offering === 'object' && 'missingReason' in offering)
}
