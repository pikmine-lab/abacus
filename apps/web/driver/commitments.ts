import type { Money, Steps } from '@abacus/use-case-language'
import type { Locator } from 'playwright'
import { amountsIn, dayShown } from './accounts.ts'
import { moneyOf, typed, type WebContext } from './context.ts'

type View = Awaited<ReturnType<Steps['readCommitment']>>

const JUDGMENTS = { essentiel: 'essential', réductible: 'reducible', 'à résilier': 'to_cancel' } as const
const JUDGMENT_LABELS = { essential: 'essentiel', reducible: 'réductible', to_cancel: 'à résilier' } as const

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

/** "1 juillet 2026", as a date field shows its day, back to "2026-07-01". */
function longDay(text: string): string {
  const [d, month, y] = text.trim().split(/\s+/) as [string, string, string]
  return `${y}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
}

const positive = (money: { amount: string; currency: string }) => ({
  ...money,
  amount: money.amount.replace('-', ''),
})

/** The screens a commitment lives on: subscriptions and financings, incomes, placements. */
const EXPENSES = '/recurring-expenses'
const INCOMES = '/recurring-income'
const PLACEMENTS = '/investments'

export function commitmentsSteps({ page, visit, pickDate, settle, exercised }: WebContext): Partial<Steps> {
  /** Picks an option of a select, by its label. */
  async function choose(scope: Locator, label: string, option: string) {
    await scope.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }

  /** Types an actor's name; Tab, not Escape, leaves the field (Escape closes the whole panel). */
  async function actor(scope: Locator, label: string, name: string) {
    const field = scope.getByRole('combobox', { name: label, exact: true })
    await field.fill(name)
    await field.press('Tab')
  }

  /** The placements section folds behind its title: unfolded, as a person opens it to read it. */
  function placements() {
    return page
      .getByRole('group')
      .filter({ has: page.getByRole('heading', { name: 'Versements programmés' }) })
  }
  async function unfoldPlacements() {
    const fold = page.locator('details', {
      has: page.getByRole('heading', { name: 'Versements programmés' }),
    })
    if ((await fold.count()) > 0 && (await fold.getAttribute('open')) === null)
      await page.getByRole('heading', { name: 'Versements programmés' }).click()
  }

  /** The running commitment of that name: the screen it is on, its row, and the account section it sits in. */
  async function locate(label: string): Promise<{ path: string; row: Locator; account?: string }> {
    for (const path of [EXPENSES, INCOMES]) {
      await visit(path)
      for (const region of await page.getByRole('region').all()) {
        const name = await region.getByRole('heading', { level: 2 }).first().innerText()
        if (name === 'À confirmer') continue
        const menu = region.getByRole('button', { name: `Actions sur ${label}`, exact: true })
        if ((await menu.count()) > 0)
          return {
            path,
            account: name,
            row: menu.locator(`xpath=ancestor::*[.//p[normalize-space()="${label}"]][1]`),
          }
      }
    }
    await visit(PLACEMENTS)
    await unfoldPlacements()
    const menu = placements().getByRole('button', { name: `Actions sur ${label}`, exact: true })
    if ((await menu.count()) > 0)
      return {
        path: PLACEMENTS,
        row: menu.locator(`xpath=ancestor::*[.//p[normalize-space()="${label}"]][1]`),
      }
    throw new Error(`no running commitment named "${label}"`)
  }

  /** Opens an item of the row's menu, on the screen the commitment lives on. */
  async function rowMenu(label: string, item: string | RegExp) {
    const { row } = await locate(label)
    await row.getByRole('button', { name: `Actions sur ${label}`, exact: true }).click()
    await page.getByRole('menuitem', { name: item }).click()
  }

  /** The pending occurrence of a commitment, in the card of what is to confirm. */
  async function pending(label: string): Promise<Locator> {
    for (const path of [EXPENSES, INCOMES, PLACEMENTS]) {
      await visit(path)
      const card = page.getByRole('region', { name: 'À confirmer', exact: true })
      const menu = card.getByRole('button', { name: `Actions sur ${label}`, exact: true })
      if ((await menu.count()) > 0)
        return menu.locator(`xpath=ancestor::*[.//p[normalize-space()="${label}"]][1]`)
    }
    throw new Error(`no occurrence of "${label}" to confirm`)
  }

  /** A confirmation is a plain form: done once its occurrence left the card, refused when the page says why. */
  async function confirmed(occurrence: Locator) {
    await Promise.race([occurrence.waitFor({ state: 'detached' }), page.waitForURL(/[?&]error=/)])
    const error = new URL(page.url()).searchParams.get('error')
    if (error) throw new Error(error)
  }

  async function readRows(path: string): Promise<string[]> {
    await exercised(`screen:${path}`)
    await visit(path)
    if (path === PLACEMENTS) {
      await unfoldPlacements()
      return labelsOf(placements())
    }
    const labels: string[] = []
    for (const region of await page.getByRole('region').all()) {
      if ((await region.getByRole('heading', { level: 2 }).first().innerText()) === 'À confirmer') continue
      labels.push(...(await labelsOf(region)))
    }
    return labels
  }

  async function labelsOf(scope: Locator): Promise<string[]> {
    const menus = await scope.getByRole('button', { name: /^Actions sur / }).all()
    return Promise.all(
      menus.map(async (m) => ((await m.getAttribute('aria-label')) ?? '').replace('Actions sur ', '')),
    )
  }

  /** The schedule panel of a financing: one line per instalment, its day and its amount. */
  async function scheduleLines(financing: string) {
    await rowMenu(financing, 'Réviser l’échéancier')
    const panel = page.getByRole('dialog', { name: financing })
    const amounts = panel.getByRole('textbox', { name: /^Montant de l’échéance / })
    await amounts.first().waitFor()
    return { panel, amounts }
  }

  return {
    async createSubscription({ label, payee, account, amount, firstDueOn }) {
      await exercised('createSubscriptionAction')
      await visit(EXPENSES)
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Nouvelle dépense récurrente' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(label)
      await actor(panel, 'Acteur (qui prélève)', payee)
      await choose(panel, 'Compte prélevé', account)
      await pickDate(panel, 'Première échéance', firstDueOn)
      await panel.getByRole('textbox', { name: 'Montant par période' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Créer l’abonnement' }).click()
      await settle(panel)
    },
    async createRecurringIncome({ label, payer, account, amount, firstDueOn }) {
      await exercised('createSubscriptionAction')
      await visit(INCOMES)
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Nouveau revenu récurrent' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(label)
      await actor(panel, 'Acteur (qui verse)', payer)
      await choose(panel, 'Compte crédité', account)
      await pickDate(panel, 'Première échéance', firstDueOn)
      await panel.getByRole('textbox', { name: 'Montant par période' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Créer', exact: true }).click()
      await settle(panel)
    },
    async createInvestmentPlan({ label, from, to, asset, amount, firstDueOn }) {
      await exercised('createInvestmentPlanAction')
      await visit(PLACEMENTS)
      await page.getByRole('button', { name: 'Programmer un versement' }).click()
      const panel = page.getByRole('dialog', { name: 'Versement programmé' })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(label)
      await choose(panel, 'Compte prélevé', from)
      await choose(panel, 'Compte investi', to)
      // The asset the person already follows is offered first; only one is followed here.
      if (!(await panel.innerText()).includes(`Actif ${asset}`) && !(await panel.innerText()).includes(asset))
        throw new Error(`the asset "${asset}" is not the one the panel offers`)
      await panel.getByRole('textbox', { name: 'Montant par période' }).fill(typed(amount))
      await pickDate(panel, 'Première échéance', firstDueOn)
      await panel.getByRole('button', { name: 'Créer le versement' }).click()
      await settle(panel)
    },
    async createFinancing({ label, creditor, account, total, instalments, firstDueOn }) {
      await exercised('createFinancingAction')
      await visit(EXPENSES)
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Nouvelle dépense récurrente' })
      await panel.getByRole('tab', { name: 'Paiement en X fois' }).click()
      await panel.getByRole('textbox', { name: 'Ce qui est financé' }).fill(label)
      await actor(panel, 'Acteur (qui prélève)', creditor)
      await choose(panel, 'Compte prélevé', account)
      await panel.getByRole('textbox', { name: 'Montant total' }).fill(typed(total))
      await panel.getByRole('textbox', { name: 'Nombre d’échéances' }).fill(String(instalments))
      await pickDate(panel, 'Première échéance', firstDueOn)
      await panel.getByRole('button', { name: 'Créer le financement' }).click()
      await settle(panel)
    },
    async reviseSchedule({ financing, plan }) {
      await exercised('reviseScheduleAction')
      const { panel, amounts } = await scheduleLines(financing)
      while ((await amounts.count()) < plan.length)
        await panel.getByRole('button', { name: 'Ajouter une échéance' }).click()
      while ((await amounts.count()) > plan.length)
        await panel.getByRole('button', { name: `Retirer l’échéance ${await amounts.count()}` }).click()
      for (const [index, line] of plan.entries()) {
        const amount = panel.getByRole('textbox', { name: `Montant de l’échéance ${index + 1}`, exact: true })
        // The line's day is the button just before its amount.
        const day = amount.locator('xpath=preceding::button[1]')
        const shown = await day.innerText()
        if (longDay(shown) !== line.dueOn) {
          const row = amount.locator('xpath=ancestor::*[.//button][1]')
          await pickDate(row, shown, line.dueOn)
        }
        await amount.fill(typed(line.amount))
      }
      await panel.getByRole('button', { name: 'Enregistrer l’échéancier' }).click()
      await settle(panel)
    },
    async readSchedule(financing) {
      await exercised(`screen:${EXPENSES}`)
      const { amounts } = await scheduleLines(financing)
      const lines = []
      for (const amount of await amounts.all()) {
        const day = await amount.locator('xpath=preceding::button[1]').innerText()
        lines.push({ dueOn: longDay(day), amount: moneyOf(await amount.inputValue()) })
      }
      await page.keyboard.press('Escape')
      return lines
    },
    async confirmOccurrence(label) {
      await exercised('confirmOccurrenceAction')
      const occurrence = await pending(label)
      await occurrence.getByRole('button', { name: 'Confirmer', exact: true }).click()
      await confirmed(occurrence)
    },
    async confirmPlacement({ plan, quantity }) {
      await exercised('confirmOccurrenceAction')
      const occurrence = await pending(plan)
      await occurrence
        .getByRole('textbox', { name: 'Quantité achetée, telle que le courtier l’affiche' })
        .fill(quantity.replace('.', ','))
      await occurrence.getByRole('button', { name: 'Confirmer', exact: true }).click()
      await confirmed(occurrence)
    },
    async skipOccurrence(label) {
      await exercised('skipOccurrenceAction')
      const occurrence = await pending(label)
      await occurrence.getByRole('button', { name: `Actions sur ${label}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Passer cette échéance' }).getByRole('button').click()
      await confirmed(occurrence)
    },
    async judgeSubscription({ subscription, judgment, note }) {
      await exercised('setJudgmentAction')
      if (note !== undefined) {
        // A note is written in a panel of its own, the judgment posed with it.
        await rowMenu(subscription, 'Annoter le jugement')
        const panel = page.getByRole('dialog', { name: subscription })
        await choose(panel, 'Jugement', JUDGMENT_LABELS[judgment])
        await panel.getByRole('textbox', { name: 'Note' }).fill(note)
        await panel.getByRole('button', { name: 'Enregistrer' }).click()
        await settle(panel)
        return
      }
      const { row } = await locate(subscription)
      const field = row.getByRole('combobox', { name: 'Jugement' })
      await field.click()
      await page.getByRole('option', { name: JUDGMENT_LABELS[judgment], exact: true }).click()
      // Sent on its own, without a form: done once the page, refreshed, shows it.
      await page.waitForLoadState('networkidle')
      await row
        .getByRole('combobox', { name: 'Jugement' })
        .filter({ hasText: JUDGMENT_LABELS[judgment] })
        .waitFor()
    },
    async renameCommitment({ commitment, label }) {
      await exercised('editCommitmentAction')
      await rowMenu(commitment, 'Modifier')
      const panel = page.getByRole('dialog', { name: commitment })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(label)
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async changeCommitmentAccount({ commitment, account }) {
      await exercised('changeCommitmentAccountAction')
      await rowMenu(commitment, 'Changer de compte')
      const panel = page.getByRole('dialog', { name: commitment })
      await panel.getByRole('combobox').first().click()
      await page.getByRole('option', { name: account, exact: true }).click()
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async changeCommitmentAmount({ commitment, amount }) {
      await exercised('changePriceAction')
      await rowMenu(commitment, /^Changer (le prix|le montant)$/)
      const panel = page.getByRole('dialog', { name: commitment })
      await panel.getByRole('textbox').first().fill(typed(amount))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async endCommitment(commitment, on) {
      await exercised('cancelCommitmentAction')
      const { row } = await locate(commitment)
      await row.getByRole('button', { name: `Actions sur ${commitment}`, exact: true }).click()
      // Each kind words its end: a subscription is cancelled, a financing closed, a placement stopped.
      const item = page.getByRole('menuitem', { name: /^(Résilier|Clore|Arrêter)$/ })
      const word = await item.innerText()
      await item.click()
      const dialog = page.getByRole('alertdialog', { name: `${word} « ${commitment} » ?` })
      if (on) await pickDate(dialog, 'Prend fin le', on)
      await dialog.getByRole('button', { name: word, exact: true }).click()
      await settle(dialog)
    },
    async receiveForCommitment({ commitment, account, payer, amount, on }) {
      await exercised('declareMovementAction')
      await visit('/movements')
      await page.getByRole('button', { name: 'Déclarer', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Déclarer un mouvement' })
      await panel.getByRole('tab', { name: 'Revenu' }).click()
      await pickDate(panel, 'Date', on)
      await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await choose(panel, 'Compte crédité', account)
      await actor(panel, 'Reçu de (acteur)', payer)
      await panel.getByRole('button', { name: 'Relier à ce qu’il rembourse ou couvre' }).click()
      await panel.getByRole('combobox', { name: 'Rembourse' }).click()
      await page.getByRole('option', { name: new RegExp(`^${commitment} \\(`) }).click()
      await panel.getByRole('button', { name: 'Déclarer', exact: true }).click()
      await settle(panel)
    },
    async readCommitment(label) {
      const { path, row, account } = await locate(label)
      await exercised(`screen:${path}`)
      const text = await row.innerText()
      const amount = amountsIn(text).pop()
      if (!amount) throw new Error(`no amount on the row of "${label}": ${text}`)
      // The rail says the next occurrence in its label: "Netflix : prochaine le 05/07/26".
      const rail = row.getByRole('button', { name: new RegExp(`^${label} : `) })
      const said = (await rail.count()) > 0 ? await rail.getAttribute('aria-label') : text
      const next = said?.match(/prochaine le (\d{2}\/\d{2}\/\d{2})/)?.[1]
      const view: View = {
        account: account ?? (await placementSource(label)),
        amount: positive(amount),
        ...(next ? { nextDueOn: dayShown(next) } : {}),
      }
      const judgment = row.getByRole('combobox', { name: 'Jugement' })
      if ((await judgment.count()) > 0) {
        const said = (await judgment.innerText()).trim() as keyof typeof JUDGMENTS
        if (JUDGMENTS[said]) view.judgment = JUDGMENTS[said]
      }
      // The person's own words about the judgment, quoted on the row.
      const judgmentNote = text.match(/« (.+?) »/)?.[1]
      if (judgmentNote) view.judgmentNote = judgmentNote
      const remaining = text.match(/reste ([\d\u202f\u00a0 ]+(?:,\d{2})?)\s*€/)?.[1]
      if (remaining) view.remainingDue = moneyOf(remaining)
      const reserve = text.match(/Réserve : (.+?€) restants/)?.[1]
      if (reserve) view.reserveLeft = moneyOf(reserve)
      return view
    },
    async readCommitmentTerms(label) {
      const { path, row } = await locate(label)
      await exercised(`screen:${path}`)
      // Partly paid back: the row says what comes back of each occurrence and
      // from whom, and the page no month's worth per line. Read on monthly
      // subscriptions only, where each occurrence is a month: the row does not
      // say its periodicity, so another one would be read wrong.
      let monthlyExpectedRefund: Money | undefined
      const text = await row.innerText()
      const expected = text.match(/([\d\s\u202f\u00a0]+,\d{2}\s?€) attendus de .+ à chaque échéance/)
      if (expected) {
        monthlyExpectedRefund = moneyOf(expected[1] as string)
      }
      // Who it pays and how it is filed are read in its correction.
      await rowMenu(label, 'Modifier')
      const panel = page.getByRole('dialog', { name: label })
      const value = (field: Locator) =>
        // A typed name is an input; a choice among a list is a button showing it.
        field.evaluate((el) =>
          (el.tagName === 'INPUT'
            ? (el as unknown as { value: string }).value
            : (el.textContent ?? '')
          ).trim(),
        )
      const payee = await value(panel.getByRole('combobox', { name: /^Acteur/ }))
      const category = await value(panel.getByRole('combobox', { name: 'Catégorie', exact: true }))
      const activity = await value(panel.getByRole('combobox', { name: 'Activité', exact: true }))
      await panel.getByRole('button', { name: 'Fermer' }).click()
      return {
        payee,
        ...(category !== '(aucune)' ? { category } : {}),
        ...(activity !== '(perso)' ? { activity } : {}),
        ...(monthlyExpectedRefund ? { monthlyExpectedRefund } : {}),
      }
    },
    async readCommitmentEnd(label) {
      // Ended expenses fold at the end of their page, stopped incomes at the end of theirs.
      for (const [path, fold] of [
        [EXPENSES, 'Terminés'],
        [INCOMES, 'Arrêtés'],
      ] as const) {
        await exercised(`screen:${path}`)
        await visit(path)
        const details = page.locator('details', {
          has: page.getByRole('heading', { name: fold, exact: true }),
        })
        if (!(await details.count())) continue
        if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
        const row = details.locator('div', { has: page.getByText(label, { exact: true }) }).last()
        if (!(await row.count())) continue
        const day = (await row.innerText()).match(/(?:résilié|soldé|arrêté) le (\d{2}\/\d{2}\/\d{2})/)?.[1]
        if (day) return dayShown(day)
      }
      throw new Error(`no ended commitment named "${label}"`)
    },
    async readRunningCommitments() {
      return [
        ...(await readRows(EXPENSES)),
        ...(await readRows(INCOMES)),
        ...(await readRows(PLACEMENTS)),
      ].sort()
    },
  }

  /** A placement's row names where it goes; where it comes from is said by its change of account. */
  async function placementSource(label: string): Promise<string> {
    await rowMenu(label, 'Changer de compte')
    const panel = page.getByRole('dialog', { name: label })
    const said = (await panel.innerText()).match(/(?:Prélevé|Versé) sur (.+?) aujourd’hui/)?.[1]
    await page.keyboard.press('Escape')
    if (!said) throw new Error(`no account said for "${label}"`)
    return said
  }
}
