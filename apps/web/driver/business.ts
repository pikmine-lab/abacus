import type { Steps } from '@abacus/use-case-language'
import type { Locator } from 'playwright'
import { moneyOf, typed, type WebContext } from './context.ts'

/**
 * The business screens: an activity's sheet in Réglages, its statement on
 * Activité (invoices, schedule, figures), and its regime page (rules, stated
 * figures, thresholds), plus the wizard that walks the regime catalog.
 */

type InvoiceState = Awaited<ReturnType<Steps['readInvoice']>>['state']
type DueStatus = Awaited<ReturnType<Steps['readDueDate']>>['status']
type RegimeWalk = Parameters<Steps['previewRegime']>[0]

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

const KINDS = {
  social: 'Cotisations sociales',
  income_tax: 'Impôt sur le revenu',
  vat: 'TVA',
  other: 'Autre',
} as const
const PERIODS = { month: 'mensuelle', quarter: 'trimestrielle' } as const
const INVOICE_STATES: Record<string, InvoiceState> = {
  'en attente': 'pending',
  'en retard': 'overdue',
  encaissée: 'paid',
  annulée: 'cancelled',
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A name at the start of an accessible name, whatever details follow it. */
const leading = (name: string) => new RegExp(`^${escaped(name)}(\\s|$)`)
/** "31/12/25" as the screens write a day, back to 2025-12-31. */
const isoOf = (day: string) => {
  const [d, m, y] = day.split('/')
  return `20${y}-${m}-${d}`
}
/** A day as a date field shows it once picked: "15 juin 2026". */
const spelled = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]} ${y}`
}
/** A number as the screens write it ("21,2", "1 200"), back to a plain decimal string. */
const numberOf = (text: string) => String(Number(text.replace(/[\s  %]/g, '').replace(',', '.')))

export function businessSteps({ page, env, visit, pickDate, settle, exercised }: WebContext): Partial<Steps> {
  /** Settles a panel whose success also resets it: its refusal, or any acknowledgement in it. */
  async function done(panel: Locator) {
    const refusal = panel.locator('.text-destructive').filter({ hasText: /\S/ })
    await Promise.race([
      refusal.first().waitFor(),
      panel.getByText(/✓/).first().waitFor(),
      panel.waitFor({ state: 'detached' }),
    ])
    if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
  }
  /** After a gesture the page answers by refreshing: what it removes goes, or the page says why. */
  async function gone(what: Locator) {
    const refusal = page.locator('main p.text-destructive').filter({ hasText: /\S/ })
    await Promise.race([what.waitFor({ state: 'detached' }), refusal.first().waitFor()])
    if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
  }
  async function choose(combobox: Locator, option: string) {
    await combobox.click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }
  async function check(boxes: Locator, wanted: string[]) {
    for (const label of await boxes.all()) {
      const name = (await label.innerText()).trim()
      const box = label.getByRole('checkbox')
      if ((await box.isChecked()) !== wanted.includes(name)) await box.click()
    }
  }

  /** An activity's sheet in Réglages. */
  async function sheet(activity: string) {
    await visit('/settings?part=activities')
    await page.getByRole('link', { name: leading(activity) }).click()
    return page.getByRole('article', { name: activity })
  }
  const accountBoxes = (scope: Locator) =>
    scope.getByText('Comptes · un compte peut en servir plusieurs').locator('xpath=..').locator('label')

  /**
   * The statement of an activity, on the fiscal year asked for. Without a name,
   * the one the screen opens on: an invoice is found by its reference alone.
   */
  async function statement(activity?: string, year?: number) {
    await visit('/activity')
    const tab = page.getByRole('tab', { name: activity, exact: true })
    if (activity && (await tab.count())) {
      await tab.click()
      await page.waitForURL(/activity=/)
    }
    await page.getByRole('heading', { name: 'Activité', level: 1 }).waitFor()
    if (year === undefined) return
    for (let i = 0; i < 10; i++) {
      const shown = Number((await page.getByText(/^exercice \d{4}$/).innerText()).slice(-4))
      if (shown === year) return
      await page
        .getByRole('button', { name: shown > year ? 'Exercice précédent' : 'Exercice suivant' })
        .click()
      await page.getByText(`exercice ${shown > year ? shown - 1 : shown + 1}`, { exact: true }).waitFor()
    }
  }
  async function unfold(title: string) {
    const fold = page.locator('details', { has: page.getByRole('heading', { name: title, exact: true }) })
    if ((await fold.count()) && (await fold.getAttribute('open')) === null)
      await fold.locator('summary').click()
  }

  /** The waiting invoice of that reference, its row and its menu. */
  function waiting(reference: string) {
    const menu = page.getByRole('button', { name: new RegExp(`^Actions sur .+ · ${escaped(reference)}$`) })
    return { menu, row: menu.locator('xpath=ancestor::div[contains(@class,"py-2.5")][1]') }
  }
  async function invoiceRow(reference: string) {
    await unfold('Factures de l’exercice')
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: reference, exact: true }) })
    const cells = await row.getByRole('cell').allInnerTexts()
    return cells.map((c) => c.split('\n')[0]!.trim())
  }

  /** A due date's row in the schedule, folded sections opened. */
  async function dueRow(due: { activity: string; levy: string; periodStart: string }) {
    await statement(due.activity, Number(due.periodStart.slice(0, 4)))
    await unfold('À venir')
    await unfold('Déjà réglées')
    const [year, month] = due.periodStart.split('-').map(Number) as [number, number]
    const what = `${MONTHS[month - 1]} ${year}`
    const title = page.getByText(`${due.levy} · ${what}`, { exact: true })
    return { row: title.locator('xpath=../..'), menuName: `Actions sur ${due.levy} ${what}` }
  }
  /** Opens the other-date field of a row through its menu, then picks the day. */
  async function otherDay(row: Locator, menuName: string, item: string, on: string) {
    if (on === env.today) return
    await row.getByRole('button', { name: menuName }).click()
    await page.getByRole('menuitem', { name: item }).click()
    await pickDate(row, spelled(env.today), on)
  }

  /** The regime page of an activity, on one of its parts. */
  async function regime(activity: string, part: 'Règles' | 'Paramètres' | 'Seuils') {
    await (await sheet(activity)).getByRole('link', { name: 'Régime' }).click()
    await page.getByRole('heading', { name: `Régime de ${activity}` }).waitFor()
    await page
      .getByRole('navigation', { name: 'Parties du régime' })
      .getByRole('link', { name: leading(part) })
      .click()
    await page.waitForURL(
      new RegExp(`part=${{ Règles: 'rules', Paramètres: 'inputs', Seuils: 'thresholds' }[part]}`),
    )
  }
  /** The entries of a part's list, without the link that opens a new one. */
  const entries = (part: string) =>
    page.locator(`main a[href*="part=${part}&entry="]:not([href$="entry=new"])`)
  /** Opens one entry of a list and waits for its sheet. */
  async function open(entry: Locator) {
    const href = (await entry.getAttribute('href')) as string
    await entry.click()
    await page.waitForURL((url) => href.endsWith(`${url.pathname}${url.search}`) || url.href.endsWith(href))
    await page.waitForLoadState('networkidle')
    return page.getByRole('article')
  }
  /** The rule of that name: the row in force, the last one listed. */
  async function rule(activity: string, levy: string) {
    await regime(activity, 'Règles')
    await entries('rules').filter({ hasText: levy }).last().click()
    const fiche = page.getByRole('article', { name: levy })
    await fiche.waitFor()
    return fiche
  }
  const fact = (fiche: Locator, term: string) =>
    fiche.getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]').innerText()

  /** Walks the wizard to the review of the model the answers lead to. */
  async function walk({ jurisdiction, answers }: RegimeWalk, name: string) {
    await visit('/settings?part=activities')
    await page.getByRole('button', { name: 'Activité', exact: true }).click()
    const wizard = page.getByRole('dialog', { name: 'Nouvelle activité' })
    await wizard.getByRole('textbox', { name: 'Nom' }).fill(name)
    await choose(wizard.getByRole('combobox', { name: 'Juridiction' }), jurisdiction)
    await wizard.getByRole('button', { name: 'Continuer' }).click()
    for (const answer of answers) {
      const option = wizard.getByRole('button', { name: leading(answer) })
      await option.click()
      await option.waitFor({ state: 'detached' })
    }
    await wizard.getByRole('heading', { name: 'Les règles' }).waitFor()
    return wizard
  }

  return {
    async createActivity({ name, kind = 'business', startedOn, accounts, regimeLabel }) {
      await exercised('createActivityAction')
      await visit('/settings?part=activities')
      await page.getByRole('button', { name: 'Activité', exact: true }).click()
      const wizard = page.getByRole('dialog', { name: 'Nouvelle activité' })
      await wizard.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (kind === 'personal') {
        await wizard.getByRole('tab', { name: 'Personnelle' }).click()
      } else {
        // The regime is configured by hand: the catalog is another gesture.
        await choose(wizard.getByRole('combobox', { name: 'Juridiction' }), 'Ailleurs, je configure moi-même')
        await wizard.getByRole('button', { name: 'Continuer' }).click()
        if (regimeLabel) await wizard.getByRole('textbox', { name: 'Régime' }).fill(regimeLabel)
        if (startedOn) await pickDate(wizard, 'Début', startedOn)
        if (accounts) await check(accountBoxes(wizard), accounts)
      }
      await wizard.getByRole('button', { name: 'Créer l’activité' }).click()
      await done(wizard)
    },
    async editActivity(activity, { name, regimeLabel }) {
      await exercised('editActivityAction')
      const fiche = await sheet(activity)
      if (name) await fiche.getByRole('textbox', { name: 'Nom' }).fill(name)
      if (regimeLabel !== undefined) await fiche.getByRole('textbox', { name: 'Régime' }).fill(regimeLabel)
      const form = fiche.locator('form').first()
      await form.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(form)
    },
    async setActivityAccounts(activity, accounts) {
      // The sheet's form states the whole list, which is how the web corrects it.
      await exercised('editActivityAction')
      const fiche = await sheet(activity)
      const form = fiche.locator('form').first()
      await check(accountBoxes(form), accounts)
      await form.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(form)
    },
    async closeActivity(activity, on) {
      await exercised('closeActivityAction')
      const region = (await sheet(activity)).getByRole('region', { name: 'Clore' })
      await pickDate(region, 'Dernier jour', on)
      await region.getByRole('button', { name: 'Clore' }).click()
      await settle(region)
    },
    async reopenActivity(activity) {
      await exercised('reopenActivityAction')
      const region = (await sheet(activity)).getByRole('region', { name: 'Réouvrir' })
      await region.getByRole('button', { name: 'Réouvrir' }).click()
      await settle(region)
    },
    async setActivityExceptions(activity, categories) {
      await exercised('setActivityExceptionsAction')
      const region = (await sheet(activity)).getByRole('region', { name: 'Exceptions de catégories' })
      await check(region.locator('label'), categories)
      await region.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(region)
    },
    async readActivity(activity) {
      await exercised('screen:/settings')
      const fiche = await sheet(activity)
      const listed = await page.getByRole('link', { name: leading(activity) }).innerText()
      const closed = listed.match(/close le (\d{2}\/\d{2}\/\d{2})/)
      const kind = (await fiche.getByRole('tab', { selected: true }).first().innerText()).trim()
      const regimeField = fiche.getByRole('textbox', { name: 'Régime' })
      const regimeLabel = (await regimeField.count()) ? await regimeField.inputValue() : ''
      const ticked = async (labels: Locator) => {
        const names: string[] = []
        for (const label of await labels.all())
          if (await label.getByRole('checkbox').isChecked()) names.push((await label.innerText()).trim())
        return names.sort((a, b) => a.localeCompare(b, 'fr'))
      }
      return {
        name: (await fiche.getByRole('heading', { level: 2 }).innerText()).trim(),
        kind: kind === 'Personnelle' ? 'personal' : 'business',
        regimeLabel: regimeLabel === '' ? null : regimeLabel,
        closedOn: closed ? isoOf(closed[1]!) : null,
        accounts: await ticked(accountBoxes(fiche)),
        exceptions: await ticked(
          fiche.getByRole('region', { name: 'Exceptions de catégories' }).locator('label'),
        ),
      }
    },

    async declareInvoice({ activity, client, reference, issuedOn, dueOn, base, vatRate }) {
      await exercised('declareInvoiceAction')
      await statement(activity)
      await page.getByRole('button', { name: 'Facture', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Enregistrer une facture' })
      // Tab, not Escape: Escape would close the whole panel.
      await panel.getByRole('combobox', { name: 'Client' }).fill(client)
      await panel.getByRole('combobox', { name: 'Client' }).press('Tab')
      await panel.getByRole('textbox', { name: 'Référence' }).fill(reference)
      await panel.getByRole('textbox', { name: 'Base HT' }).fill(typed(base))
      await pickDate(panel, 'Émise le', issuedOn)
      if (dueOn) await pickDate(panel, 'Échéance', dueOn)
      if (vatRate !== undefined)
        await panel
          .getByRole('group', { name: 'TVA collectée' })
          .getByRole('textbox', { name: 'Taux (%)' })
          .fill(vatRate.replace('.', ','))
      await panel.getByRole('button', { name: 'Enregistrer la facture' }).click()
      await settle(panel)
    },
    async correctInvoice(reference, { base }) {
      await exercised('correctInvoiceAction')
      await statement()
      await waiting(reference).menu.click()
      await page.getByRole('menuitem', { name: 'Modifier' }).click()
      const panel = page.getByRole('dialog', { name: 'Modifier la facture' })
      await panel.getByRole('textbox', { name: 'Base HT' }).fill(typed(base))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async remindInvoice(reference) {
      await exercised('remindInvoiceAction')
      await statement()
      const { menu, row } = waiting(reference)
      await menu.click()
      await page.getByRole('menuitem', { name: 'Relancée aujourd’hui' }).click()
      await row.getByText(/relancée le/).waitFor()
    },
    async cancelInvoice(reference) {
      await exercised('cancelInvoiceAction')
      await statement()
      const { menu, row } = waiting(reference)
      await menu.click()
      await page.getByRole('menuitem', { name: 'Annuler la facture' }).click()
      const confirm = page.getByRole('alertdialog')
      await confirm.getByRole('button', { name: 'Annuler la facture' }).click()
      // The confirmation closes on success only, and hides the list while it is open.
      await done(confirm)
      await gone(row)
    },
    async settleInvoice({ reference, account, on }) {
      await exercised('settleInvoiceAction')
      await statement()
      const { row } = waiting(reference)
      const label = (await row.locator('p').first().innerText()).trim()
      await otherDay(row, `Actions sur ${label}`, 'Encaissée à une autre date…', on)
      await choose(row.getByRole('combobox', { name: /^Compte crédité par / }), account)
      await row.getByRole('button', { name: 'Encaissée', exact: true }).click()
      await gone(row)
    },
    async readInvoice(reference) {
      await exercised('screen:/activity')
      await statement()
      const [issuedOn, client, , base, vat, , receivable, state] = await invoiceRow(reference)
      return {
        client: client!,
        issuedOn: isoOf(issuedOn!),
        base: moneyOf(base!),
        vat: moneyOf(vat!),
        receivable: moneyOf(receivable!),
        state: INVOICE_STATES[state!] ?? (state as InvoiceState),
      }
    },
    async readInvoiceReminder(reference) {
      await exercised('screen:/activity')
      await statement()
      const { row } = waiting(reference)
      if (!(await row.count())) return null
      const reminded = (await row.innerText()).match(/relancée le (\d{2}\/\d{2}\/\d{2})/)
      return reminded ? isoOf(reminded[1]!) : null
    },

    async createLevy({ activity, name, kind, validFrom, rate, period, source, settledIn }) {
      await exercised('createLevyAction')
      await regime(activity, 'Règles')
      await page.getByRole('button', { name: 'Règle', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Nouvelle règle' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(name)
      await choose(panel.getByRole('combobox', { name: 'Nature' }), KINDS[kind])
      await pickDate(panel, 'En vigueur à partir du', validFrom)
      await panel.getByRole('textbox', { name: 'Source (URL du texte)' }).fill(source.url)
      await pickDate(panel, 'Vérifiée le', source.readOn)
      await panel.getByRole('textbox', { name: 'Taux (%)' }).fill(rate.replace('.', ','))
      await choose(panel.getByRole('combobox', { name: 'Périodicité' }), PERIODS[period])
      if (settledIn) await choose(panel.getByRole('combobox', { name: 'Catégorie qui la règle' }), settledIn)
      await panel.getByRole('button', { name: 'Créer la règle' }).click()
      await settle(panel)
    },
    async correctLevyRate(activity, levy, rate) {
      await exercised('editLevyAction')
      const fiche = await rule(activity, levy)
      await fiche.getByRole('button', { name: 'Modifier' }).click()
      const panel = page.getByRole('dialog', { name: levy })
      await panel.getByRole('textbox', { name: 'Taux (%)' }).fill(rate.replace('.', ','))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async supersedeLevy(activity, levy, { from, rate, source }) {
      await exercised('supersedeLevyAction')
      const fiche = await rule(activity, levy)
      await fiche.getByRole('button', { name: 'Remplacer à une date' }).click()
      const panel = page.getByRole('dialog', { name: `Remplacer « ${levy} »` })
      await pickDate(panel, 'Nouvelles valeurs à partir du', from)
      await panel.getByRole('textbox', { name: 'Source (URL du texte)' }).fill(source.url)
      await pickDate(panel, 'Vérifiée le', source.readOn)
      await panel.getByRole('textbox', { name: 'Taux (%)' }).fill(rate.replace('.', ','))
      await panel.getByRole('button', { name: 'Remplacer la règle' }).click()
      await settle(panel)
    },
    async closeLevy(activity, levy, on) {
      await exercised('closeLevyAction')
      const region = (await rule(activity, levy)).getByRole('region', { name: 'Clore' })
      await pickDate(region, 'Dernier jour d’application', on)
      await region.getByRole('button', { name: 'Clore' }).click()
      await settle(region)
    },
    async deleteLevy(activity, levy) {
      await exercised('deleteLevyAction')
      const fiche = await rule(activity, levy)
      await fiche
        .getByRole('region', { name: 'Supprimer' })
        .getByRole('button', { name: 'Supprimer' })
        .click()
      const confirm = page.getByRole('alertdialog')
      await confirm.getByRole('button', { name: 'Supprimer' }).click()
      await done(confirm)
      await fiche.waitFor({ state: 'detached' })
    },
    async addLevyModifier(activity, levy, { label, rateFactor, months }) {
      await exercised('addModifierAction')
      const fiche = await rule(activity, levy)
      await fiche.getByRole('button', { name: 'Ajouter un modificateur' }).click()
      const panel = page.getByRole('dialog', { name: `Modificateur de ${levy}` })
      await panel.getByRole('textbox', { name: 'Ce que tu affirmes' }).fill(label)
      await choose(panel.getByRole('combobox', { name: 'Effet' }), 'Facteur sur le taux')
      await panel.getByRole('textbox', { name: 'Valeur' }).fill(rateFactor.replace('.', ','))
      await choose(panel.getByRole('combobox', { name: 'Durée' }), 'mois civils')
      await panel.getByRole('textbox', { name: 'Nombre de mois' }).fill(String(months))
      await panel.getByRole('button', { name: 'Ajouter' }).click()
      await settle(panel)
    },
    async removeLevyModifier(activity, levy, label) {
      await exercised('removeModifierAction')
      const fiche = await rule(activity, levy)
      const remove = fiche.getByRole('button', { name: `Retirer ${label}` })
      await remove.click()
      await remove.waitFor({ state: 'detached' })
    },
    async readLevies(activity) {
      await exercised('screen:/settings/activities')
      await regime(activity, 'Règles')
      const levies = []
      for (let i = 0; i < (await entries('rules').count()); i++) {
        const fiche = await open(entries('rules').nth(i))
        const amount = await fact(fiche, 'Montant')
        const validity = await fact(fiche, 'Validité')
        const days = validity.match(/\d{2}\/\d{2}\/\d{2}/g) ?? []
        const modifiers = await fiche
          .getByRole('region', { name: 'Modificateurs' })
          .getByRole('button', { name: /^Retirer / })
          .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''))
        levies.push({
          name: (await fiche.getByRole('heading', { level: 2 }).innerText()).trim(),
          validFrom: isoOf(days[0]!),
          validTo: validity.startsWith('du ') ? isoOf(days[1]!) : null,
          rate: amount.trim().endsWith('%') ? numberOf(amount) : null,
          modifiers: modifiers.map((m) => m.trim().replace(/^Retirer /, '')),
        })
      }
      return levies
    },

    async readStatement(activity, year) {
      await exercised('screen:/activity')
      await statement(activity, year)
      const text = await page.getByRole('main').first().innerText()
      const revenue = text.match(/Chiffre d’affaires (?:encaissé|facturé)\n+([^\n]+)/)
      const net = text.match(/\nNet\n+([^\n]+)\n+[^\n]*· ([^\n]+) encore dus/)
      if (!revenue || !net) throw new Error(`no statement figures on the screen: ${text.slice(0, 400)}`)
      return { revenue: moneyOf(revenue[1]!), net: moneyOf(net[1]!), reserve: moneyOf(net[2]!) }
    },
    async readDueDate(due) {
      await exercised('screen:/activity')
      const { row } = await dueRow(due)
      const text = await row.innerText()
      let status: DueStatus
      if (/payée le/.test(text)) status = 'paid'
      else if (/\ndéclarée à 0(\n|$)/.test(text)) status = 'nil_return'
      else if (/rien à déclarer ni à payer/.test(text)) status = 'nothing_due'
      else if (/en retard de/.test(text)) status = 'overdue'
      else status = 'upcoming'
      const estimated = text.match(/estimée à ([^\n·]+€)/)
      const amount =
        status === 'paid'
          ? moneyOf(estimated![1]!)
          : moneyOf((await row.locator('span.font-mono').first().innerText()).trim())
      return { amount, status }
    },
    async declareNilReturn(due) {
      await exercised('confirmNilReturnAction')
      const { row } = await dueRow(due)
      const file = row.getByRole('button', { name: 'Déclarée à 0' })
      await file.click()
      // The title moves to the settled rows: what goes is the gesture.
      await gone(file)
    },
    async withdrawNilReturn(due) {
      await exercised('withdrawNilReturnAction')
      const { row, menuName } = await dueRow(due)
      await row.getByRole('button', { name: menuName }).click()
      await page.getByRole('menuitem', { name: 'Retirer la déclaration à 0' }).click()
      await gone(row.getByRole('button', { name: menuName }))
    },
    async payLevy({ amount, on, account, payee, ...due }) {
      await exercised('confirmLevyPaymentAction')
      const { row, menuName } = await dueRow(due)
      await otherDay(row, menuName, 'Payé à une autre date…', on)
      await row.getByRole('textbox', { name: /^Montant réellement payé pour / }).fill(typed(amount))
      await choose(row.getByRole('combobox', { name: /^Compte débité pour / }), account)
      await row.getByRole('combobox', { name: /^Organisme payé pour / }).fill(payee)
      const paid = row.getByRole('button', { name: 'Payé', exact: true })
      await paid.click()
      await gone(paid)
    },

    async setActivityFigure(activity, { name, validFrom, value }) {
      await exercised('setInputAction')
      await regime(activity, 'Paramètres')
      await page.getByRole('link', { name: 'Paramètre', exact: true }).click()
      const fiche = page.getByRole('article', { name: 'Nouveau paramètre' })
      await fiche.getByRole('textbox', { name: 'Nom' }).fill(name)
      await pickDate(fiche, 'À partir du', validFrom)
      await fiche.getByRole('textbox', { name: 'Valeur' }).fill(value.replace('.', ','))
      await fiche.getByRole('button', { name: 'Ajouter' }).click()
      await settle(fiche)
    },
    async removeActivityFigure(activity, { name, validFrom }) {
      await exercised('removeInputAction')
      await regime(activity, 'Paramètres')
      const [y, m, d] = validFrom.split('-')
      await entries('inputs')
        .filter({ hasText: name })
        .filter({ hasText: `à partir du ${d}/${m}/${y!.slice(2)}` })
        .click()
      const remove = page.getByRole('button', { name: `Retirer ${name}` })
      await remove.click()
      await remove.waitFor({ state: 'detached' })
    },
    async readActivityFigures(activity) {
      await exercised('screen:/settings/activities')
      await regime(activity, 'Paramètres')
      const figures = []
      for (const entry of await entries('inputs').all()) {
        const text = (await entry.innerText()).replace(/\s+/g, ' ').trim()
        const read = text.match(/^(\S+) à partir du (\d{2}\/\d{2}\/\d{2}) (.+)$/)
        if (!read) throw new Error(`not a stated figure: "${text}"`)
        figures.push({ name: read[1]!, validFrom: isoOf(read[2]!), value: numberOf(read[3]!) })
      }
      return figures
    },

    async createThreshold({ activity, label, value, consequence }) {
      await exercised('createThresholdAction')
      await regime(activity, 'Seuils')
      await page.getByRole('link', { name: 'Seuil', exact: true }).click()
      const fiche = page.getByRole('article', { name: 'Nouveau seuil' })
      await fiche.getByRole('textbox', { name: 'Libellé' }).fill(label)
      await fiche.getByRole('textbox', { name: 'Valeur' }).fill(typed(value))
      await fiche.getByRole('textbox', { name: 'Ce qui change au-delà' }).fill(consequence)
      await fiche.getByRole('button', { name: 'Créer le seuil' }).click()
      await settle(fiche)
    },
    async editThreshold(activity, label, { value }) {
      await exercised('editThresholdAction')
      await regime(activity, 'Seuils')
      await entries('thresholds').filter({ hasText: label }).click()
      const fiche = page.getByRole('article', { name: label })
      await fiche.getByRole('textbox', { name: 'Valeur' }).fill(typed(value))
      const form = fiche.locator('form').first()
      await form.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(form)
    },
    async removeThreshold(activity, label) {
      await exercised('removeThresholdAction')
      await regime(activity, 'Seuils')
      await entries('thresholds').filter({ hasText: label }).click()
      const fiche = page.getByRole('article', { name: label })
      await fiche.getByRole('region', { name: 'Retirer' }).getByRole('button', { name: 'Retirer' }).click()
      const confirm = page.getByRole('alertdialog')
      await confirm.getByRole('button', { name: 'Retirer' }).click()
      await done(confirm)
      await fiche.waitFor({ state: 'detached' })
    },
    async readThresholds(activity) {
      await exercised('screen:/settings/activities')
      await regime(activity, 'Seuils')
      const thresholds = []
      for (let i = 0; i < (await entries('thresholds').count()); i++) {
        const fiche = await open(entries('thresholds').nth(i))
        thresholds.push({
          label: await fiche.getByRole('textbox', { name: 'Libellé' }).inputValue(),
          value: moneyOf(await fiche.getByRole('textbox', { name: 'Valeur' }).inputValue()),
          consequence: await fiche.getByRole('textbox', { name: 'Ce qui change au-delà' }).inputValue(),
        })
      }
      return thresholds
    },

    async previewRegime(walked) {
      await exercised('regimeStepAction')
      await exercised('regimePreviewAction')
      const wizard = await walk(walked, 'Aperçu')
      const block = wizard.getByRole('heading', { name: 'Les règles' }).locator('xpath=../..')
      // A rule's line opens on its name, before its status badge.
      const rules = await block
        .locator('span.flex-1')
        .evaluateAll((spans) => spans.map((s) => (s.childNodes[0]?.textContent ?? '').trim()))
      const model = await wizard.locator('p.font-medium').first().innerText()
      return { model: model.trim(), rules }
    },
    async createActivityFromRegime({ name, startedOn, accounts, ...walked }) {
      await exercised('regimeStepAction')
      await exercised('regimePreviewAction')
      await exercised('createActivityFromRegimeAction')
      const wizard = await walk(walked, name)
      await wizard.getByRole('button', { name: 'Continuer' }).click()
      await pickDate(wizard, 'Début', startedOn)
      await check(accountBoxes(wizard), accounts)
      await wizard.getByRole('button', { name: 'Créer l’activité' }).click()
      await done(wizard)
    },
  }
}
