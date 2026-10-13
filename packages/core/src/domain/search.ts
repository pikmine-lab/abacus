/**
 * How a free-text search over movements reads what was typed. A search is
 * typed from memory: a fragment of a name, an amount, a word of the note, in
 * any order. So the text is cut into words, and every word has to be found
 * somewhere on the movement, each in any of its fields: "resto 86" finds the
 * 86.40 spent at "Le Petit Resto", which a match on the whole text never would.
 *
 * Read here once, for every list that searches (the ledger, the link pickers,
 * the MCP), so the same words find the same movements everywhere.
 */
export interface SearchTerm {
  /** The word as typed, matched as a fragment of a text field. */
  text: string
  /**
   * When the word reads as an amount, the euros it names, as a prefix: "86"
   * covers 86.00 to 86.99, "86,4" covers 86.40 to 86.49. Upper bound excluded.
   */
  amount?: { from: string; to: string }
}

/**
 * The words read from a search, at most this many. Each word costs the query
 * a pass over the movement's fields; nobody remembers a movement in more
 * words than this, and a pasted paragraph must not become a query that scans
 * the ledger once per word.
 */
export const MAX_SEARCH_TERMS = 8

/** "86", "86,4", "86.40", "86," and "86€": digits, then at most two decimals. */
const AMOUNT = /^(\d+)(?:[.,](\d{0,2}))?$/

/**
 * A word, or an amount written in groups of three digits ("1 200", "12 300,50
 * €"), which is one amount and not several words. The group must end the
 * number, so "86 100%" stays two words.
 */
const WORD = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d*)?(?=€|\s|$)|\S+/g

export function searchTerms(input: string | undefined | null): SearchTerm[] {
  if (!input) return []
  return (input.match(WORD) ?? [])
    .map((word) => word.replace(/€/g, ''))
    .filter((word) => word.length > 0)
    .slice(0, MAX_SEARCH_TERMS)
    .map((text) => {
      const match = AMOUNT.exec(text.replace(/[   ]/g, ''))
      if (!match) return { text }
      const decimals = match[2] ?? ''
      const from = BigInt(match[1]!) * 100n + BigInt(decimals.padEnd(2, '0'))
      const to = from + 10n ** BigInt(2 - decimals.length)
      return { text, amount: { from: cents(from), to: cents(to) } }
    })
}

function cents(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`
}

/** Accent- and case-insensitive, as the query's unaccent and ilike are. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * The same rule, for what is matched outside the query: every word found in
 * one of the texts, or, when it reads as an amount, naming one of the amounts.
 */
export function matchesSearch(terms: SearchTerm[], texts: string[], amounts: number[]): boolean {
  const folded = texts.map(fold)
  return terms.every(
    (term) =>
      folded.some((text) => text.includes(fold(term.text))) ||
      (term.amount !== undefined &&
        amounts.some((a) => a >= Number(term.amount!.from) && a < Number(term.amount!.to))),
  )
}
