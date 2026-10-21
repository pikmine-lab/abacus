import type { Steps } from '@abacus/use-case-language'
import { listVenues, searchInstruments } from '../src/prices/search.ts'
import type { PreparationContext } from './context.ts'

export function venuesSteps(_ctx: PreparationContext): Partial<Steps> {
  return {
    async readVenuesOf(query) {
      const [fund] = await searchInstruments(query)
      if (!fund) throw new Error(`nothing found for "${query}"`)
      return (await listVenues(fund.name)).map((v) => ({
        ticker: v.reference,
        venue: v.venue ?? '',
        price: { amount: Number(v.price ?? 0).toFixed(2), currency: v.currency ?? 'EUR' },
      }))
    },
  }
}
