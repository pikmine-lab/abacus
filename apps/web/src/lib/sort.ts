import { resolveSort, type SortChoice, type SortFields } from '@abacus/core/domain/sort'

/**
 * A list's order, as the page hands it to its controls. The criteria and the
 * defaults come from the service that builds the list, so a screen never
 * decides on its own what "biggest first" means here.
 */
export interface Sorter<Field extends string> {
  /** The URL parameter carrying this list's order, named after the list. */
  param: string
  fields: SortFields<Field>
  fallback: SortChoice<Field>
  /** What the page actually queried with, fallback included. */
  current: SortChoice<Field>
}

/**
 * An order is a framing, like the period and the filters, so it lives in the
 * URL: a sorted list is shareable, survives a reload and comes undone with the
 * back button. One parameter per list, named after it, because several lists
 * share a page and each is ordered on its own.
 *
 * The value reads `<criterion>-<direction>`; anything else falls back to the
 * default order, so a hand-typed parameter never costs the list itself.
 */
export function sorter<Field extends string>(
  param: string,
  fields: SortFields<Field>,
  fallback: SortChoice<Field>,
  params: Record<string, string | undefined>,
): Sorter<Field> {
  const [field, direction] = (params[param] ?? '').split('-')
  return { param, fields, fallback, current: resolveSort(fields, fallback, field, direction) }
}

/**
 * The value the parameter takes when a criterion is designated: its own
 * opening direction, or the opposite of the current one when it is already the
 * criterion in force, which is what makes a second click reverse the list.
 * Undefined when the result is the default order, so the parameter goes away
 * rather than writing down what nothing needed saying.
 */
export function nextSortValue<Field extends string>(
  { fields, fallback, current }: Sorter<Field>,
  field: Field,
): string | undefined {
  const direction = current.field === field ? (current.direction === 'asc' ? 'desc' : 'asc') : fields[field]
  if (field === fallback.field && direction === fallback.direction) return undefined
  return `${field}-${direction}`
}
