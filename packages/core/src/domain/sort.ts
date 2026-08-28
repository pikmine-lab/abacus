/**
 * How a list is ordered, and the one place both interfaces read it from: the
 * web writes it in the URL, the MCP takes it as a field and a direction, and
 * the criteria a list offers are declared beside the service that builds it.
 * A screen and a tool that decided this apart would rank the same list two
 * ways and neither would be wrong.
 */
export type SortDirection = 'asc' | 'desc'

/** A criterion and the way it runs, as a list is actually ordered. */
export interface SortChoice<Field extends string> {
  field: Field
  direction: SortDirection
}

/**
 * What a criterion opens on, when the reader picked the criterion and not a
 * direction: a name reads A to Z, a figure and a past date read biggest and
 * most recent first, a deadline reads soonest first. Asking is what a default
 * is for, so each criterion states its own rather than sharing one.
 */
export type SortFields<Field extends string> = Record<Field, SortDirection>

/**
 * Reads a stored choice against the criteria a list actually offers. Anything
 * else (a stale link, a hand-typed parameter, a tool passing a criterion this
 * list does not have) falls back to the default order rather than failing: an
 * order is a framing, and a wrong framing must never cost the list itself.
 */
export function resolveSort<Field extends string>(
  fields: SortFields<Field>,
  fallback: SortChoice<Field>,
  field?: string | null,
  direction?: string | null,
): SortChoice<Field> {
  if (!field || !(field in fields)) return fallback
  const chosen = field as Field
  return {
    field: chosen,
    direction: direction === 'asc' || direction === 'desc' ? direction : fields[chosen],
  }
}

/** Accent- and case-insensitive, the way a French reader expects a list of names. */
const NAMES = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/**
 * Compares two sort keys. What is unknown sorts last whichever way the list
 * runs: a position with no price is not the most valuable one because the
 * order was reversed. The SQL sorts say the same thing with `nulls last`.
 */
export function compareKeys(a: string | number | null, b: string | number | null): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  if (typeof a === 'string' || typeof b === 'string') return NAMES.compare(String(a), String(b))
  return a - b
}

/**
 * Orders a list held whole in memory, on the key each item answers. Lists
 * short enough to be read at once sort here; the ones a screen truncates sort
 * in SQL, where ordering the page instead of the list would be a false order.
 */
export function sortBy<T>(
  items: T[],
  key: (item: T) => string | number | null,
  direction: SortDirection,
): T[] {
  const way = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const left = key(a)
    const right = key(b)
    // Unknown last in both directions, so the reversal never promotes it.
    if (left === null || right === null) return compareKeys(left, right)
    return compareKeys(left, right) * way
  })
}
