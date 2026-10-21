import type { Steps } from '@abacus/use-case-language'
import type { Locator, Page } from 'playwright'
import { moneyOf, typed, type WebContext } from './context.ts'

/** "2026-05-25" as the screens write a day: "25/05/26". */
export const shownDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`

/** "25/05/26" as the screens write it, back to "2026-05-25". */
export function dayShown(text: string): string {
  const [d, m, y] = text.split('/') as [string, string, string]
  return `20${y}-${m}-${d}`
}

// Thousands are grouped by a narrow space, never a line break: a day written
// just before an amount must not be read as its first digits.
const AMOUNT = /[−-]?\+?\d{1,3}(?:[  ]\d{3})*,\d{2}\s?€/g

/** Every amount a piece of the screen writes, in order. */
export function amountsIn(text: string) {
  return (text.match(AMOUNT) ?? []).map((a) => moneyOf(a.replace('+', '')))
}

const MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

/** Picks a month (`YYYY-MM`) in the popover a month field opens. */
async function pickMonth(page: Page, scope: Locator, label: string, month: string) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  const popover = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: 'Année suivante' }) })
  const year = Number(month.slice(0, 4))
  for (let i = 0; i < 50; i++) {
    const shown = Number((await popover.innerText()).match(/\d{4}/)?.[0])
    if (shown === year) break
    await popover.getByRole('button', { name: shown < year ? 'Année suivante' : 'Année précédente' }).click()
  }
  await popover
    .getByRole('button', { name: MONTHS_SHORT[Number(month.slice(5, 7)) - 1], exact: true })
    .click()
}

/** Picks a day of the month in the popover a day field opens; 31 is the end of the month. */
async function pickDayOfMonth(page: Page, scope: Locator, label: string, day: number) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: day === 31 ? 'fin de mois' : `le ${day}`, exact: true })
    .click()
}

export function accountsSteps({ page, visit, pickDate, settle, exercised }: WebContext): Partial<Steps> {
  /** The row of an account in its list, the closed ones included. */
  function accountRow(account: string) {
    return page
      .getByRole('button', { name: `Actions sur ${account}`, exact: true })
      .locator('xpath=ancestor::*[contains(normalize-space(.), "€")][1]')
  }

  async function openAccountMenu(account: string, item: string) {
    await page.getByRole('button', { name: `Actions sur ${account}`, exact: true }).click()
    await page.getByRole('menuitem', { name: item, exact: true }).click()
  }

  /** Unfolds every account that carries cards, as a person opens them to see the cards. */
  async function revealCards() {
    const folded = page.locator('details:not([open]) > summary')
    while ((await folded.count()) > 0) await folded.first().click()
  }

  /** Opens the page of a card, from the account it debits. */
  async function visitCard(card: string) {
    await visit('/accounts')
    await revealCards()
    await page.getByRole('link', { name: `Ouvrir la carte ${card}`, exact: true }).click()
    await page.getByRole('heading', { level: 1, name: card, exact: true }).waitFor()
  }

  function statementFold(cutOff: string) {
    return page
      .getByRole('region', { name: 'Relevés' })
      .getByRole('group')
      .filter({ hasText: new RegExp(`(Arrêté le|En cours jusqu’au) ${shownDay(cutOff)}`) })
  }

  /** The checks history of an account, opened from its menu. */
  async function openChecks(account: string) {
    await visit('/accounts')
    await openAccountMenu(account, 'Pointages')
    return page.getByRole('dialog', { name: `Pointages de ${account}` })
  }

  async function checkMenu(account: string, on: string, item: string) {
    const sheet = await openChecks(account)
    await sheet
      .getByRole('button', { name: `Actions sur le pointage du ${shownDay(on)}`, exact: true })
      .click()
    await page.getByRole('menuitem', { name: item, exact: true }).click()
  }

  return {
    async createAccount({ name, opening, openedOn }) {
      await exercised('createAccountAction')
      await visit('/accounts')
      await page.getByRole('button', { name: 'Ajouter un compte' }).click()
      const panel = page.getByRole('dialog', { name: 'Nouveau compte' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (opening) await panel.getByRole('textbox', { name: 'Solde d’ouverture (€)' }).fill(typed(opening))
      const day = opening ? (openedOn ?? '2026-01-01') : openedOn
      if (day) await pickDate(panel, 'Ouvert le', day)
      await panel.getByRole('button', { name: 'Créer le compte' }).click()
      await settle(panel)
    },
    async readAccountBalance(account) {
      await exercised('screen:/accounts')
      await visit('/accounts')
      const row = page
        .getByRole('button', { name: `Actions sur ${account}`, exact: true })
        .locator('xpath=ancestor::*[contains(normalize-space(.), "€")][1]')
      const text = await row.innerText()
      const amounts = text.match(/−?-?[\d\s  ]+,\d{2}\s?€/g)
      if (!amounts) throw new Error(`no balance on the row of "${account}": ${text}`)
      return moneyOf(amounts[amounts.length - 1] as string)
    },
    async editAccount({ account, name, institution, opening, openedOn }) {
      await exercised('editAccountAction')
      await visit('/accounts')
      await openAccountMenu(account, 'Modifier')
      const panel = page.getByRole('dialog', { name: account })
      if (name !== undefined) await panel.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (institution !== undefined)
        await panel.getByRole('textbox', { name: 'Établissement (optionnel)' }).fill(institution)
      if (opening) await panel.getByRole('textbox', { name: 'Solde d’ouverture (€)' }).fill(typed(opening))
      if (openedOn) await pickDate(panel, 'Ouvert le', openedOn)
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async closeAccount(account) {
      await exercised('closeAccountAction')
      await visit('/accounts')
      await openAccountMenu(account, 'Clore le compte')
      const dialog = page.getByRole('alertdialog', { name: `Clore « ${account} » ?` })
      await dialog.getByRole('button', { name: 'Clore', exact: true }).click()
      await settle(dialog)
    },
    async reopenAccount(account) {
      await exercised('reopenAccountAction')
      await visit('/accounts')
      await openAccountMenu(account, 'Réouvrir')
      const dialog = page.getByRole('alertdialog', { name: `Réouvrir « ${account} » ?` })
      await dialog.getByRole('button', { name: 'Réouvrir', exact: true }).click()
      await settle(dialog)
    },
    async readAccount(account) {
      await exercised('screen:/accounts')
      await visit('/accounts')
      const row = accountRow(account)
      const amounts = amountsIn(await row.innerText())
      const balance = amounts[amounts.length - 1]
      if (!balance) throw new Error(`no balance on the row of "${account}"`)
      // The institution is written right after the name, in a fainter type.
      const institution = row
        .getByText(account, { exact: true })
        .locator('xpath=following-sibling::span[contains(@class, "text-faint")][1]')
      const closed = await page
        .getByRole('region', { name: 'Clos', exact: true })
        .getByText(account, { exact: true })
        .count()
      return {
        ...((await institution.count()) > 0 ? { institution: await institution.innerText() } : {}),
        balance,
        closed: closed > 0,
      }
    },

    async createCard(input) {
      await exercised('createCardAction')
      await visit('/accounts')
      await openAccountMenu(input.account, 'Ajouter une carte')
      const panel = page.getByRole('dialog', { name: 'Nouvelle carte' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(input.name)
      await pickMonth(page, panel, 'Expire fin', input.expiry)
      if (input.debit === 'immediate') await panel.getByRole('tab', { name: 'Débit immédiat' }).click()
      else {
        await panel.getByRole('tab', { name: 'Débit différé' }).click()
        await pickDayOfMonth(page, panel, 'Arrêté des achats', input.cutOffDay)
        await pickDayOfMonth(page, panel, 'Prélèvement', input.debitDay)
      }
      await panel.getByRole('button', { name: 'Ajouter la carte' }).click()
      await settle(panel)
    },
    async editCard({ card, name, expiry }) {
      await exercised('editCardAction')
      await visit('/accounts')
      await revealCards()
      await page.getByRole('button', { name: `Actions sur ${card}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Modifier', exact: true }).click()
      const panel = page.getByRole('dialog', { name: card })
      if (name !== undefined) await panel.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (expiry) await pickMonth(page, panel, 'Expire fin', expiry)
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async deleteCard(card) {
      await exercised('deleteCardAction')
      await visit('/accounts')
      await revealCards()
      await page.getByRole('button', { name: `Actions sur ${card}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: `Supprimer « ${card} » ?` })
      await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click()
      await settle(dialog)
    },
    async readCards(account) {
      await exercised('screen:/accounts')
      await visit('/accounts')
      await revealCards()
      const row = page.getByRole('group').filter({ has: page.getByText(account, { exact: true }) })
      if ((await row.count()) === 0) return []
      const cards = row.getByRole('link', { name: /^Ouvrir la carte / })
      const found = []
      for (const link of await cards.all()) {
        const name = ((await link.getAttribute('aria-label')) ?? '').replace('Ouvrir la carte ', '')
        const [, mm, yy] = (await link.innerText()).match(/(\d{2})\/(\d{2})\s*$/) ?? []
        if (!mm) throw new Error(`no expiry on the card "${name}"`)
        const expiry = `20${yy}-${mm}`
        // The schedule is written under the card: "arrêté le 25, prélevé en fin de mois".
        const block = await link.locator('xpath=..').innerText()
        const schedule = block.match(
          /arrêté (?:le (\d+)|en fin de mois), prélevé (?:le (\d+)|en fin de mois)/,
        )
        found.push(
          schedule
            ? {
                name,
                expiry,
                debit: 'deferred' as const,
                cutOffDay: Number(schedule[1] ?? 31),
                debitDay: Number(schedule[2] ?? 31),
              }
            : { name, expiry, debit: 'immediate' as const },
        )
      }
      return found
    },
    async validateStatement({ card, cutOff, debitedOn }) {
      await exercised('confirmStatementAction')
      await visitCard(card)
      await statementFold(cutOff).getByRole('button', { name: 'Valider', exact: true }).click()
      const panel = page.getByRole('dialog', { name: `Relevé de ${card}` })
      await pickDate(panel, 'Débité le', debitedOn)
      await panel.getByRole('button', { name: 'Valider', exact: true }).click()
      await settle(panel)
    },
    async undoStatement({ card, cutOff }) {
      await exercised('undoStatementAction')
      await visitCard(card)
      await statementFold(cutOff).getByRole('button', { name: 'Corriger', exact: true }).click()
      const panel = page.getByRole('dialog', { name: `Relevé de ${card}` })
      await panel.getByRole('button', { name: 'Annuler la validation' }).click()
      await settle(panel)
    },
    async readCardStatements(card) {
      await exercised('screen:/accounts/cards/[cardId]')
      await visitCard(card)
      const folds = page.getByRole('region', { name: 'Relevés' }).getByRole('group')
      const statements = []
      for (const fold of await folds.all()) {
        // The header line: its cycle, its state, its total; the purchases follow.
        const header = await fold.locator('summary').innerText()
        const cut = header.match(/(?:Arrêté le|En cours jusqu’au) (\d{2}\/\d{2}\/\d{2})/)?.[1]
        if (!cut) throw new Error(`no cut-off on a statement of "${card}": ${header}`)
        const debited = header.match(/débité le (\d{2}\/\d{2}\/\d{2})/)?.[1]
        const amount = amountsIn(header).pop()
        if (!amount) throw new Error(`no total on the statement cut off on ${cut}`)
        statements.push({
          cutOff: dayShown(cut),
          ...(debited ? { debitedOn: dayShown(debited) } : {}),
          amount: { ...amount, amount: amount.amount.replace('-', '') },
        })
      }
      return statements
    },

    async recordBalanceCheck({ account, balance }) {
      await exercised('recordBalanceCheckAction')
      await visit('/accounts')
      await openAccountMenu(account, 'Pointer le solde')
      const panel = page.getByRole('dialog', { name: `Pointer ${account}` })
      await panel.getByRole('textbox', { name: 'Solde réel (€)' }).fill(typed(balance))
      await panel.getByRole('button', { name: 'Pointer', exact: true }).click()
      await settle(panel)
    },
    async correctBalanceCheck({ account, on, balance }) {
      await exercised('correctBalanceCheckAction')
      await checkMenu(account, on, 'Corriger')
      const panel = page.getByRole('dialog', { name: `Pointage du ${shownDay(on)}` })
      await panel.getByRole('textbox', { name: 'Solde réel (€)' }).fill(typed(balance))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async deleteBalanceCheck({ account, on }) {
      await exercised('deleteBalanceCheckAction')
      await checkMenu(account, on, 'Supprimer')
      const dialog = page.getByRole('alertdialog', { name: `Supprimer le pointage du ${shownDay(on)} ?` })
      await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click()
      await settle(dialog)
    },
    async settleCheckGap({ account, on, actor }) {
      await exercised('settleCheckGapAction')
      await checkMenu(account, on, 'Solder l’écart')
      const panel = page.getByRole('dialog', { name: 'Solder l’écart' })
      await panel.getByRole('combobox', { name: 'Attribué à' }).fill(actor)
      await panel.getByRole('button', { name: 'Solder', exact: true }).click()
      await settle(panel)
    },
    async readBalanceChecks(account) {
      await exercised('screen:/accounts')
      const sheet = await openChecks(account)
      const menus = sheet.getByRole('button', { name: /^Actions sur le pointage du / })
      const checks: Awaited<ReturnType<Steps['readBalanceChecks']>> = []
      for (const menu of await menus.all()) {
        const row = menu.locator('xpath=..')
        const text = await row.innerText()
        const on = text.match(/\d{2}\/\d{2}\/\d{2}/)?.[0]
        if (!on) throw new Error(`no day on a check of "${account}": ${text}`)
        const [declared, computed] = amountsIn(text.replace(/écart de [^\n·]*/, '')) as [
          ReturnType<typeof moneyOf>,
          ReturnType<typeof moneyOf>,
        ]
        const gap = text.match(/écart de ([^\n·]*€)/)?.[1]
        checks.push({
          on: dayShown(on),
          declared,
          computed,
          gap: gap ? moneyOf(gap) : { amount: '0.00', currency: 'EUR' },
          settled: text.includes('soldé par un ajustement'),
        })
      }
      return checks
    },
  }
}
