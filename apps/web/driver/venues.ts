import type { Steps } from '@abacus/use-case-language'
import type { WebContext } from './context.ts'

export function venuesSteps({ page, visit, exercised }: WebContext): Partial<Steps> {
  return {
    async readVenuesOf(query) {
      await exercised('screen:/investments')
      await visit('/investments')
      await page.getByRole('main').getByRole('button', { name: 'Suivre', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Suivre un actif' })
      const searched = page.waitForResponse((r) => r.url().includes('/api/instruments/search'))
      await panel.locator('[cmdk-input]').fill(query)
      await searched
      await panel
        .getByRole('button', { name: /autres? cotations? du même fonds/ })
        .first()
        .click()
      // "WRLD.DE · XETRA 520,5 EUR", the retained one marked "· retenue".
      const line = /^(\S+) · (.+?)(?: · retenue)? ([\d\s  ]+(?:,\d+)?) ([A-Z]{3})$/
      await panel.getByRole('option', { name: line }).first().waitFor()
      const names = await panel.getByRole('option', { name: line }).allInnerTexts()
      return names.map((text) => {
        const [, ticker, venue, number, currency] = text.replace(/\s+/g, ' ').trim().match(line) as string[]
        const amount = Number((number as string).replace(/[\s  ]/g, '').replace(',', '.')).toFixed(2)
        return {
          ticker: ticker as string,
          venue: venue as string,
          price: { amount, currency: currency as string },
        }
      })
    },
  }
}
