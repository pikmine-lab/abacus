import type { Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function venuesSteps({ call }: McpContext): Partial<Steps> {
  return {
    async readVenuesOf(query) {
      const [fund] = await call<{ name: string }[]>('search_instruments', { query })
      if (!fund) throw new Error(`nothing found for "${query}"`)
      const venues = await call<{ reference: string; venue?: string; price?: number; currency?: string }[]>(
        'list_instrument_venues',
        { fund: fund.name },
      )
      return venues.map((v) => ({
        ticker: v.reference,
        venue: v.venue ?? '',
        price: { amount: (v.price ?? 0).toFixed(2), currency: v.currency ?? 'EUR' },
      }))
    },
  }
}
