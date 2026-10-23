import type { Steps } from '@abacus/use-case-language'
import type { Locator } from 'playwright'
import { moneyOf, typed, type WebContext } from './context.ts'
import { correctionRefusal, escaped, isoDay, shortDate } from './ledger.ts'

type ShareRef = Parameters<Steps['removeShare']>[0]
type OpenClaim = Awaited<ReturnType<Steps['readOpenClaims']>>[number]

/** A day as a date field shows it: "15 juin 2026". */
const longDate = (day: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))

const AMOUNT = /−?[\d\s  ]+,\d{2}\s?€/

/**
 * The claims still awaited are the card heading the movements, one line per
 * person and per expense: its menu is named after both, and the line around it
 * carries what is owed, the plan's next payment and the refund's own gesture.
 */
export function advancesSteps({ page, visit, pickDate, env }: WebContext): Partial<Steps> {
  const claims = () => page.getByRole('region', { name: 'À récupérer' })
  const menuName = ({ expense, debtor }: ShareRef) =>
    `Actions sur ${debtor} · ${expense.counterparty} du ${shortDate(expense.on)}`

  /** The line of that claim, and its menu. */
  async function claimLine(share: ShareRef): Promise<{ line: Locator; menu: Locator }> {
    await visit('/movements')
    const menu = claims().getByRole('button', { name: menuName(share), exact: true })
    const line = menu.locator('xpath=ancestor::div[.//button[normalize-space()="Remboursé"]][1]')
    return { line, menu }
  }

  /**
   * Sends a plain form, whose action answers with the page refreshed, or
   * comes back to it with its refusal in the address.
   */
  async function sent(submit: Locator): Promise<void> {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && !!r.request().headers()['next-action']),
      submit.click(),
    ])
    await page.waitForLoadState('networkidle')
    const refusal = new URL(page.url()).searchParams.get('error')
    if (refusal) throw new Error(refusal)
  }

  /** Opens a claim's plan, in the panel its menu opens. */
  async function planning(share: ShareRef): Promise<Locator> {
    const { menu } = await claimLine(share)
    await menu.click()
    await page.getByRole('menuitem', { name: /chéancier…$/ }).click()
    return page.getByRole('dialog', { name: `Quand ${share.debtor} rembourse` })
  }

  /** Opens the expense of a share, then its correction. */
  async function correcting({ expense }: ShareRef): Promise<Locator> {
    await visit('/movements')
    await page
      .getByRole('button', {
        name: new RegExp(`^Ouvrir ${escaped(shortDate(expense.on))} · ${escaped(expense.counterparty)} · `),
      })
      .click()
    await page
      .getByRole('dialog', { name: expense.counterparty })
      .getByRole('button', { name: 'Corriger' })
      .click()
    return page.getByRole('dialog', { name: 'Corriger le mouvement' })
  }

  return {
    async refundShare({ amount, on, ...share }) {
      const { line, menu } = await claimLine(share)
      if (on !== env.today) {
        await menu.click()
        await page.getByRole('menuitem', { name: 'Revenu à une autre date…' }).click()
        await pickDate(line, longDate(env.today), on)
      }
      await line.getByRole('textbox', { name: `Montant remboursé par ${share.debtor}` }).fill(typed(amount))
      await sent(line.getByRole('button', { name: 'Remboursé', exact: true }))
    },
    async removeShare(share) {
      const panel = await correcting(share)
      await panel.getByRole('button', { name: `Retirer la part de ${share.debtor}`, exact: true }).click()
      const confirm = page.getByRole('alertdialog', { name: `Retirer la part de ${share.debtor} ?` })
      await confirm.getByRole('button', { name: 'Retirer', exact: true }).click()
      // Done at once, outside the form: the confirmation closes on the answer,
      // then the share's box goes. Until then the dialog hides the panel.
      await confirm.waitFor({ state: 'detached' })
      const refusal = correctionRefusal(panel)
      await Promise.race([
        panel
          .getByRole('button', { name: `Retirer la part de ${share.debtor}`, exact: true })
          .waitFor({ state: 'detached' }),
        refusal.first().waitFor(),
      ])
      if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
    },
    async planShare({ count, firstDueOn, ...share }) {
      const sheet = await planning(share)
      await sheet.getByRole('textbox', { name: 'Nombre d’échéances' }).fill(String(count))
      await pickDate(sheet, 'Première échéance', firstDueOn)
      await sheet.getByRole('button', { name: 'Enregistrer l’échéancier' }).click()
      await sheet.waitFor({ state: 'detached' })
    },
    async dropSharePlan(share) {
      const sheet = await planning(share)
      await sheet.getByRole('button', { name: 'Retirer l’échéancier' }).click()
      // The panel stays open on the claim without a plan: the plan it showed goes.
      await sheet.getByText('Échéancier actuel').waitFor({ state: 'detached' })
    },
    async writeOffShare(share) {
      const { menu } = await claimLine(share)
      await menu.click()
      await sent(page.getByRole('menuitem', { name: 'Solder : rien de plus ne reviendra' }))
    },
    async readOpenClaims() {
      await visit('/movements')
      await page.getByRole('heading', { name: 'Mouvements', level: 1 }).waitFor()
      if ((await claims().count()) === 0) return []
      const found: OpenClaim[] = []
      for (const menu of await claims()
        .getByRole('button', { name: /^Actions sur / })
        .all()) {
        const name = (await menu.getAttribute('aria-label')) ?? ''
        const [, debtor, counterparty, day] =
          name.match(/^Actions sur (.+) · (.+) du (\d\d\/\d\d\/\d\d)$/) ?? []
        if (!(debtor && counterparty && day)) throw new Error(`not a claim of an expense: "${name}"`)
        const text = await menu
          .locator('xpath=ancestor::div[.//button[normalize-space()="Remboursé"]][1]')
          .innerText()
        const owes = text.match(new RegExp(`doit (${AMOUNT.source})`))
        if (!owes) throw new Error(`no amount owed on the claim "${name}": ${text}`)
        const next = text.match(
          new RegExp(`prochain versement : (${AMOUNT.source}) le (\\d\\d/\\d\\d/\\d\\d)`),
        )
        found.push({
          debtor,
          expense: { counterparty, on: isoDay(day) },
          remaining: moneyOf(owes[1] as string),
          ...(next ? { nextDue: { on: isoDay(next[2] as string), amount: moneyOf(next[1] as string) } } : {}),
        })
      }
      return found
    },
  }
}
