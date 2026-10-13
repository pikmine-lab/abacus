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

/** "86", "86,4", "86.40", "86," and "86€": digits, then at most two decimals. */
const AMOUNT = /^(\d+)(?:[.,](\d{0,2}))?$/

export function searchTerms(input: string | undefined | null): SearchTerm[] {
  if (!input) return []
  // "1 200" is one amount, not two words: a space, narrow or not, between
  // digit groups is how amounts are written.
  const joined = input.replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, '$1')
  return joined
    .split(/\s+/)
    .map((word) => word.replace(/€/g, ''))
    .filter((word) => word.length > 0)
    .map((text) => {
      const match = AMOUNT.exec(text)
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
