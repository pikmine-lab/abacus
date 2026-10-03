/**
 * The URL of one entry of a list-and-sheet screen: the list's own URL, which
 * carries the part and its order, plus the entry it designates (an id, or
 * `new` for a blank sheet).
 */
export function entryHref(listHref: string, entry: string): string {
  return `${listHref}${listHref.includes('?') ? '&' : '?'}entry=${encodeURIComponent(entry)}`
}
