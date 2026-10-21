import type { Steps } from '@abacus/use-case-language'
import type { Page } from 'playwright'
import { longDay, type WebContext } from './context.ts'
import { ledgerSteps } from './ledger.ts'

/** The rows of a Réglages list, in the order shown: its group headings and its entries, from the pane with the search. */
async function listed(
  page: Page,
  part: string,
): Promise<{ heading?: string; name?: string; detail?: string; trailing?: string }[]> {
  return await page.getByRole('searchbox').evaluate((search, part) => {
    let pane: typeof search | null = search
    while (pane && !pane.querySelector(`a[href*="part=${part}&entry="]`)) pane = pane.parentElement
    if (!pane) return []
    return [...pane.querySelectorAll(`h3, a[href*="part=${part}&entry="]`)]
      .filter((el) => !el.getAttribute('href')?.endsWith('entry=new'))
      .map((el) =>
        el.tagName === 'H3'
          ? { heading: el.firstChild?.textContent ?? '' }
          : {
              name: el.firstElementChild?.firstElementChild?.textContent ?? '',
              detail: el.firstElementChild?.children[1]?.textContent ?? undefined,
              trailing: el.querySelector(':scope > span.shrink-0')?.textContent ?? undefined,
            },
      )
  }, part)
}

export function catalogSteps(context: WebContext): Partial<Steps> {
  const { page, visit, settle, exercised } = context
  /** The fiche of an entry, opened from its row in the list. */
  async function fiche(part: string, name: string) {
    await visit(`/settings?part=${part}`)
    await page
      .getByRole('link')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
      .click()
    const sheet = page.getByRole('main').getByRole('article', { name })
    await sheet.waitFor()
    return sheet
  }

  return {
    async createCategory({ name, group }) {
      await exercised('createCategoryAction')
      await visit('/settings?part=categories&entry=new')
      const sheet = page.getByRole('main').getByRole('article', { name: 'Nouvelle catégorie' })
      await sheet.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (group) {
        const field = sheet.getByRole('combobox', { name: 'Groupe (optionnel)' })
        await field.fill(group)
        await field.press('Tab')
      }
      await sheet.getByRole('button', { name: 'Ajouter' }).click()
      await settle(sheet)
    },
    async editCategory({ category, name, group }) {
      await exercised('editCategoryAction')
      const sheet = await fiche('categories', category)
      if (name) await sheet.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (group !== undefined) {
        const field = sheet.getByRole('combobox', { name: 'Groupe (optionnel)' })
        await field.fill(group ?? '')
        // Tab, not Escape: the suggestions it opens would cover the button.
        await field.press('Tab')
      }
      await sheet.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(sheet)
    },
    async readCategories() {
      await exercised('screen:/settings')
      await visit('/settings?part=categories')
      const categories = []
      let group: string | null = null
      for (const row of await listed(page, 'categories')) {
        if (row.heading !== undefined)
          group = row.heading.trim() === 'Sans groupe' ? null : row.heading.trim()
        else categories.push({ name: row.name ?? '', group })
      }
      return categories
    },
    async createActor(name) {
      await exercised('createActorAction')
      await visit('/settings?part=actors&entry=new')
      const sheet = page.getByRole('main').getByRole('article', { name: 'Nouvel acteur' })
      await sheet.getByRole('textbox', { name: 'Nom' }).fill(name)
      await sheet.getByRole('button', { name: 'Ajouter' }).click()
      await settle(sheet)
    },
    async editActor({ actor, name, activity }) {
      await exercised('editActorAction')
      const sheet = await fiche('actors', actor)
      if (name) await sheet.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (activity !== undefined) {
        await sheet.getByRole('combobox', { name: 'Activité' }).click()
        await page.getByRole('option', { name: activity ?? '(perso)', exact: true }).click()
      }
      await sheet.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(sheet)
    },
    async addAlias({ actor, alias }) {
      await exercised('addAliasAction')
      const sheet = await fiche('actors', actor)
      const aliases = sheet.getByRole('region', { name: 'Alias' })
      await aliases.getByRole('textbox', { name: 'Nouvel alias' }).fill(alias)
      await aliases.getByRole('button', { name: 'Ajouter' }).click()
      await settle(aliases)
    },
    async mergeActors({ keep, absorb }) {
      await exercised('mergeActorsAction')
      const sheet = await fiche('actors', absorb)
      const merge = sheet.getByRole('region', { name: 'Fusionner' })
      await merge.getByRole('combobox', { name: 'Fusionner dans' }).click()
      await page.getByRole('option', { name: keep, exact: true }).click()
      await merge.getByRole('button', { name: 'Fusionner' }).click()
      // The absorbed actor's fiche goes away with it.
      await settle(sheet)
    },
    async reattachActorHistory(actor) {
      // The confirmation counts what it will take before it is given.
      await exercised('countReattachableAction')
      await exercised('reattachActorHistoryAction')
      const sheet = await fiche('actors', actor)
      await sheet
        .getByRole('region', { name: 'Historique' })
        .getByRole('button', { name: /^Rattacher l’historique/ })
        .click()
      const dialog = page.getByRole('alertdialog')
      await dialog.getByText(/passera sous/).waitFor()
      await dialog.getByRole('button', { name: 'Rattacher', exact: true }).click()
      await settle(dialog)
    },
    async readActors() {
      await exercised('screen:/settings')
      await visit('/settings?part=actors')
      if ((await page.getByRole('searchbox').count()) === 0) return []
      return (await listed(page, 'actors')).map((row) => ({
        name: row.name ?? '',
        activity: row.trailing ?? null,
        // "aussi Macdo, McDo" under the name.
        aliases: row.detail ? row.detail.replace(/^aussi\s+/, '').split(', ') : [],
      }))
    },
    async previewReattachActorHistory(actor) {
      await exercised('countReattachableAction')
      const sheet = await fiche('actors', actor)
      await sheet
        .getByRole('region', { name: 'Historique' })
        .getByRole('button', { name: /^Rattacher l’historique/ })
        .click()
      // The confirmation counts before anything is given: read, then cancelled.
      const dialog = page.getByRole('alertdialog')
      const said = dialog.getByText(/passer(a|ont) sous|^Rien à rattacher/)
      await said.waitFor()
      const text = await said.innerText()
      await dialog.getByRole('button', { name: 'Annuler' }).click()
      await dialog.waitFor({ state: 'detached' })
      if (text.startsWith('Rien à rattacher')) return { movements: 0, since: null }
      const count = text.match(/^(\d+) mouvements?/)?.[1]
      if (!count) throw new Error(`no count in "${text}"`)
      const since = text.match(/depuis le (\d{1,2} \S+ \d{4})/)?.[1]
      return { movements: Number(count), since: since ? longDay(since) : null }
    },
    async declareExpenseToUnknownPayee({ account, amount, payee, on }) {
      // The web asks nothing: the payee typed is created by the declaration,
      // and a refusal of the form fails the step.
      await ledgerSteps(context).declareExpense!({ account, amount, payee, on })
    },
  }
}
