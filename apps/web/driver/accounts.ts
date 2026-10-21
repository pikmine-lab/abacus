import type { Steps } from '@abacus/use-case-language'
import { moneyOf, type WebContext } from './context.ts'

export function accountsSteps({ page, visit, exercised }: WebContext): Partial<Steps> {
  return {
    async readAccountBalance(account) {
      await exercised('screen:/accounts')
      await visit('/accounts')
      const row = page
        .getByRole('button', { name: `Actions sur ${account}`, exact: true })
        .locator('xpath=ancestor::*[contains(normalize-space(.), "€")][1]')
      const text = await row.innerText()
      const amounts = text.match(/−?-?[\d\s\u202f\u00a0]+,\d{2}\s?€/g)
      if (!amounts) throw new Error(`no balance on the row of "${account}": ${text}`)
      return moneyOf(amounts[amounts.length - 1] as string)
    },
  }
}
