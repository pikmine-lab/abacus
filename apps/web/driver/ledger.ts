import type { Steps } from '@abacus/use-case-language'
import { typed, type WebContext } from './context.ts'

export function ledgerSteps({ page, visit, pickDate, settle, exercised }: WebContext): Partial<Steps> {
  return {
    async declareExpense({ account, amount, payee, on }) {
      await exercised('declareMovementAction')
      await visit('/movements')
      await page.getByRole('button', { name: 'Déclarer', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Déclarer un mouvement' })
      await pickDate(panel, 'Date', on)
      await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await panel.getByRole('combobox', { name: 'Compte débité' }).click()
      await page.getByRole('option', { name: account, exact: true }).click()
      // Tab, not Escape: Escape would close the whole panel.
      await panel.getByRole('combobox', { name: 'Payé à (acteur)' }).fill(payee)
      await panel.getByRole('combobox', { name: 'Payé à (acteur)' }).press('Tab')
      await panel.getByRole('button', { name: 'Déclarer', exact: true }).click()
      await settle(panel)
    },
  }
}
