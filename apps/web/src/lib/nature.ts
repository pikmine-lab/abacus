import type { AssetNature } from '@abacus/core/domain'

/*
 * The masses' names, in the words a holder uses for them, live in the catalog
 * (`investments.natures.<nature>`): this module only holds their orders.
 */

/**
 * What can be declared by hand, which is only ever asked of an asset no source
 * quotes: a quoted one is typed by its source. Property first, being what one
 * most often holds outside a market, and crypto absent, being always quoted.
 */
export const DECLARED_NATURES: AssetNature[] = ['real_estate', 'equity', 'fund', 'bond', 'other']

/**
 * The order masses take when nothing is worth ranking them by, as on a
 * watchlist: what is quoted first, "other" last, so the list does not reshuffle
 * every time a line is added.
 */
export const NATURE_ORDER: AssetNature[] = ['equity', 'fund', 'crypto', 'bond', 'real_estate', 'other']
