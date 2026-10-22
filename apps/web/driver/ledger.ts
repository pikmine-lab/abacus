import type { Money, Steps } from '@abacus/use-case-language'
import type { Locator } from 'playwright'
import { moneyOf, typed, type WebContext } from './context.ts'

type MovementRef = Parameters<Steps['deleteMovement']>[0]

/** A day as the lists write it: "03/06/26". */
export const shortDate = (day: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))

/** "03/06/26" back to "2026-06-03". */
export const isoDay = (short: string) => {
  const [day, month, year] = short.split('/')
  return `20${year}-${month}-${day}`
}

export const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A correction's refusal, read in its form only: the panel also holds the
 * zone that deletes the movement, whose heading wears the destructive colour.
 */
export const correctionRefusal = (panel: Locator) =>
  panel.locator('form').first().locator('.text-destructive').filter({ hasText: /\S/ })

/** After a correction is saved: throws its refusal, returns once the panel is back to reading. */
async function corrected(panel: Locator): Promise<void> {
  const refusal = correctionRefusal(panel)
  await Promise.race([refusal.first().waitFor(), panel.waitFor({ state: 'detached' })])
  if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
}

export function ledgerSteps(ctx: WebContext): Partial<Steps> {
  const { page, visit, pickDate, settle } = ctx

  /** Opens the declaration panel on a kind of movement, its date and amount filled. */
  async function declaring(kind: 'Dépense' | 'Revenu' | 'Virement', on: string, amount: Money) {
    await visit('/movements')
    await page.getByRole('button', { name: 'Déclarer', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Déclarer un mouvement' })
    if (kind !== 'Dépense') await panel.getByRole('tab', { name: kind }).click()
    await pickDate(panel, 'Date', on)
    await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
    return panel
  }

  async function choose(panel: Locator, field: string, option: string) {
    await panel.getByRole('combobox', { name: field }).click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }

  async function actor(panel: Locator, field: string, name: string, nth = 0) {
    // Tab, not Escape: Escape would close the whole panel.
    const input = panel.getByRole('combobox', { name: field }).nth(nth)
    await input.fill(name)
    await input.press('Tab')
  }

  async function submit(panel: Locator) {
    await panel.getByRole('button', { name: 'Déclarer', exact: true }).click()
    await settle(panel)
  }

  /** Opens a movement of the list, then its correction. */
  async function correcting({ counterparty, on }: MovementRef): Promise<Locator> {
    await visit('/movements')
    await page
      .getByRole('button', {
        name: new RegExp(`^Ouvrir ${escaped(shortDate(on))} · ${escaped(counterparty)} · `),
      })
      .click()
    await page.getByRole('dialog', { name: counterparty }).getByRole('button', { name: 'Corriger' }).click()
    return page.getByRole('dialog', { name: 'Corriger le mouvement' })
  }

  return {
    async declareExpense({ account, amount, payee, on }) {
      const panel = await declaring('Dépense', on, amount)
      await choose(panel, 'Compte débité', account)
      await actor(panel, 'Payé à (acteur)', payee)
      await submit(panel)
    },
    async declareIncome({ account, amount, payer, on }) {
      const panel = await declaring('Revenu', on, amount)
      await choose(panel, 'Compte crédité', account)
      await actor(panel, 'Reçu de (acteur)', payer)
      await submit(panel)
    },
    async declareTransfer({ from, to, amount, on }) {
      const panel = await declaring('Virement', on, amount)
      await choose(panel, 'Compte débité', from)
      await choose(panel, 'Vers le compte', to)
      await submit(panel)
    },
    async declareSharedExpense({ account, amount, payee, on, shares }) {
      const panel = await declaring('Dépense', on, amount)
      await choose(panel, 'Compte débité', account)
      await actor(panel, 'Payé à (acteur)', payee)
      for (const [index, share] of shares.entries()) {
        await panel.getByRole('button', { name: 'Attendre un remboursement' }).click()
        await actor(panel, 'Qui doit ?', share.debtor, index)
        await panel.getByRole('textbox', { name: 'Sa part (€)' }).nth(index).fill(typed(share.amount))
      }
      await submit(panel)
    },
    async declareRefund({ account, amount, debtor, on, refunds }) {
      const panel = await declaring('Revenu', on, amount)
      await choose(panel, 'Compte crédité', account)
      await actor(panel, 'Reçu de (acteur)', debtor)
      await panel.getByRole('button', { name: 'Relier à ce qu’il rembourse ou couvre' }).click()
      // The field searches the whole history: the expense is found by its payee.
      await panel.getByRole('combobox', { name: 'Rembourse' }).fill(refunds.counterparty)
      await page
        .getByRole('listbox', { name: 'Rembourse' })
        .getByRole('group', { name: 'Trouvés' })
        .getByRole('option', {
          name: new RegExp(`^${escaped(refunds.counterparty)} · .* le ${escaped(shortDate(refunds.on))}$`),
        })
        .click()
      await submit(panel)
    },
    async correctMovementAmount({ movement, amount }) {
      const panel = await correcting(movement)
      await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await corrected(panel)
    },
    async deleteMovement(movement) {
      const panel = await correcting(movement)
      await panel.getByRole('button', { name: 'Supprimer', exact: true }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Supprimer ce mouvement ?' })
      await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click()
      // The confirmation holds the refusal; on success it closes, then the panel.
      await settle(confirm)
      await panel.waitFor({ state: 'detached' })
    },
    async unlinkRefund(refund) {
      const panel = await correcting(refund)
      await panel.getByRole('button', { name: 'Détacher ce remboursement' }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Détacher ce remboursement ?' })
      await confirm.getByRole('button', { name: 'Détacher', exact: true }).click()
      // Done at once, outside the form: the confirmation closes on the answer
      // (it hides the panel until then), and the link gives way to the offer
      // to link again, or to the refusal.
      await confirm.waitFor({ state: 'detached' })
      const refusal = correctionRefusal(panel)
      await Promise.race([
        panel.getByRole('button', { name: 'Relier à ce qu’il rembourse ou couvre' }).waitFor(),
        refusal.first().waitFor(),
      ])
      if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
    },
    async readNetSpent({ payee, month }) {
      await visit(`/analysis?period=month&ref=${month}&by=actor`)
      const ranking = page.getByRole('region', { name: 'Dépenses par acteur' })
      await ranking.waitFor()
      // Each actor of the ranking reads "<name>, <net>, <share of the month>",
      // the net rounded to the euro by the screen.
      const row = ranking.getByRole('button', { name: new RegExp(`^${escaped(payee)}, `) })
      if ((await row.count()) === 0) return moneyOf('0 €')
      const label = (await row.first().getAttribute('aria-label')) ?? (await row.first().innerText())
      return moneyOf(label.slice(payee.length + 2).split(', ')[0] as string)
    },
    async readMovementLinks({ counterparty, on }) {
      await visit('/movements')
      await page
        .getByRole('button', {
          name: new RegExp(`^Ouvrir ${escaped(shortDate(on))} · ${escaped(counterparty)} · `),
        })
        .click()
      const panel = page.getByRole('dialog', { name: counterparty })
      await panel.getByRole('button', { name: 'Corriger' }).waitFor()
      const facts = await panel.evaluate((dialog) =>
        Object.fromEntries(
          [...dialog.querySelectorAll('dt')].map((dt) => [
            dt.textContent ?? '',
            dt.nextElementSibling?.textContent ?? '',
          ]),
        ),
      )
      const activity = facts['Activité']
      const invoice = facts['Règle la facture']
      const box = panel.locator('a[href*="?commitment="]')
      const commitment =
        (await box.count()) > 0 ? await box.locator('span span').first().innerText() : undefined
      // An occurrence says where it comes from in its commitment's box.
      const occurrence =
        (await panel.getByRole('heading', { name: 'Échéance de', exact: true }).count()) > 0 ||
        (await panel.getByText('Ce mouvement vient d’une échéance confirmée.').count()) > 0
      const adjustment = (await panel.getByText('Ce mouvement est un ajustement de pointage.').count()) > 0
      return {
        ...(activity && activity !== 'aucune' ? { activity } : {}),
        ...(commitment ? { commitment } : {}),
        ...(invoice ? { invoice } : {}),
        ...(occurrence
          ? { origin: 'commitment' as const }
          : adjustment
            ? { origin: 'balanceCheck' as const }
            : {}),
      }
    },
  }
}
