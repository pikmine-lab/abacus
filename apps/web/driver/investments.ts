import type { AssetNature, Money, OperationRef, OperationType, Steps } from '@abacus/use-case-language'
import type { Locator } from 'playwright'
import { moneyOf, typed, type WebContext } from './context.ts'

const TYPES: Record<OperationType, string> = {
  buy: 'Achat',
  sell: 'Vente',
  dividend: 'Dividende',
  fee: 'Frais',
}

const NATURES: Record<AssetNature, string> = {
  equity: 'Actions',
  fund: 'Fonds',
  bond: 'Obligations',
  real_estate: 'Immobilier',
  other: 'Autre',
}

/** "12,5" or "1 000" as the screen formats a number, back to a decimal string. */
function decimalOf(text: string): string {
  const cleaned = text
    .replace(/[\s  ]/g, '')
    .replace('−', '-')
    .replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`not a number: "${text}"`)
  return String(Number(cleaned))
}

/** "↑ +200,00 €" as a gain reads, back to an amount. */
const gainOf = (text: string) => moneyOf(text.replace(/[↑↓+]/g, ''))

/** "01/06/26", the journal's short date, back to a day. */
function dayOf(text: string): string {
  const [day, month, year] = text.trim().split('/')
  return `20${year}-${month}-${day}`
}

/** A day as the journal writes it. */
function shortDay(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year!.slice(2)}`
}

/** The name the panel tags an amount with, by operation type. */
function amountLabel(type: OperationType): string {
  if (type === 'buy') return 'Montant débité, frais compris'
  if (type === 'sell') return 'Montant crédité'
  if (type === 'dividend') return 'Montant reçu'
  return 'Montant des frais'
}

export function investmentsSteps({ page, visit, pickDate, settle, exercised }: WebContext): Partial<Steps> {
  /** Types a query in a search field and waits for the market's answer to be drawn. */
  async function searchIn(panel: Locator, query: string): Promise<void> {
    const answered = page.waitForResponse((r) => r.url().includes('/api/instruments/search'))
    await panel.locator('[cmdk-input]').fill(query)
    await answered
    // The answer is in; one frame for the list to be drawn from it.
    await page.waitForTimeout(100)
  }

  async function openFollow(): Promise<Locator> {
    await visit('/investments')
    await page.getByRole('main').getByRole('button', { name: 'Suivre', exact: true }).click()
    return page.getByRole('dialog', { name: 'Suivre un actif' })
  }

  /** The menu button of an operation's row, told apart from its neighbours of the same day by its asset. */
  async function operationMenu(ref: OperationRef): Promise<Locator> {
    await visit('/investments')
    const buttons = page.getByRole('button', {
      name: `Actions sur ${TYPES[ref.type]} du ${shortDay(ref.on)}`,
      exact: true,
    })
    const subject = ref.asset ?? 'frais de compte'
    for (const button of await buttons.all()) {
      const row = button.locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " grid ")][1]')
      if ((await row.textContent())?.includes(subject)) return button
    }
    throw new Error(`no ${ref.type} of ${subject} on ${ref.on} in the journal`)
  }

  return {
    async searchInstruments(query) {
      await exercised('screen:/investments')
      const panel = await openFollow()
      await searchIn(panel, query)
      const hits = await panel.locator('[cmdk-item][data-value^="new:"]').evaluateAll((items) =>
        items.map((item) => ({
          name: item.querySelector('.truncate')?.textContent ?? '',
          ticker: (item.getAttribute('data-value') ?? '').slice('new:'.length),
          price: item.querySelector('.tabular')?.textContent ?? '',
        })),
      )
      return hits.map((hit) => {
        const [number, currency] = hit.price.trim().split(/\s(?=[A-Za-z]+$)/) as [string, string]
        return {
          name: hit.name,
          ticker: hit.ticker,
          price: { amount: Number(decimalOf(number)).toFixed(2), currency },
        }
      })
    },
    async followInstrument({ query, ticker, as }) {
      await exercised('declareAssetAction')
      const panel = await openFollow()
      await searchIn(panel, query)
      await panel.locator(`[cmdk-item][data-value="new:${ticker}" i]`).click()
      await panel.getByRole('textbox', { name: 'Sous quel nom' }).fill(as)
      await panel.getByRole('button', { name: 'Suivre', exact: true }).click()
      await settle(panel)
    },
    async followUnquotedAsset({ name, nature }) {
      await exercised('declareAssetAction')
      const panel = await openFollow()
      await panel.getByRole('button', { name: /Aucune source ne le cote/ }).click()
      await panel.getByRole('textbox', { name: 'Sous quel nom' }).fill(name)
      await panel.getByRole('combobox', { name: 'Nature' }).click()
      await page.getByRole('option', { name: NATURES[nature], exact: true }).click()
      await panel.getByRole('button', { name: 'Suivre', exact: true }).click()
      await settle(panel)
    },
    async renameAsset({ asset, to }) {
      await exercised('renameAssetAction')
      await visit('/investments')
      await page
        .getByRole('button', { name: `Actions sur ${asset}`, exact: true })
        .first()
        .click()
      await page.getByRole('menuitem', { name: 'Renommer' }).click()
      const panel = page.getByRole('dialog', { name: asset })
      await panel.getByRole('textbox', { name: 'Nom' }).fill(to)
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async stopFollowing(asset) {
      await exercised('stopFollowingAction')
      await visit('/investments')
      await page.getByRole('button', { name: `Actions sur ${asset}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Arrêter de suivre' }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.getByRole('button', { name: 'Arrêter', exact: true }).click()
      await settle(dialog)
    },
    async refreshPrices() {
      // Prices are refreshed as the screen is read.
      await exercised('screen:/investments')
      await visit('/investments')
    },
    async readFollowedAssets() {
      await exercised('screen:/investments')
      await visit('/investments')
      const block = page.getByRole('region', { name: 'Suivis' })
      if ((await block.count()) === 0) return []
      const rows = await block.getByRole('button', { name: /^Actions sur / }).evaluateAll((buttons) =>
        buttons.map((button) => ({
          name: (button.getAttribute('aria-label') ?? button.textContent ?? '').replace(/^Actions sur /, ''),
          price: button.parentElement?.querySelector('.tabular')?.textContent ?? '',
        })),
      )
      return rows.map((row) => ({ name: row.name, price: row.price === '—' ? null : moneyOf(row.price) }))
    },
    async recordOperation({ account, type, asset, quantity, amount, on }) {
      await exercised('recordOperationAction')
      await visit('/investments')
      await page.getByRole('button', { name: 'Déclarer une opération' }).click()
      const panel = page.getByRole('dialog', { name: 'Opération' })
      await panel.getByRole('tab', { name: TYPES[type], exact: true }).click()
      await panel.getByRole('combobox', { name: 'Compte' }).click()
      await page.getByRole('option', { name: account, exact: true }).click()
      if (asset) {
        // The panel opens on a known asset when there is one; its search
        // offers the known ones first, under their own heading.
        const change = panel.getByRole('button', { name: 'Changer' })
        const search = panel.locator('[cmdk-input]')
        await change.or(search).first().waitFor()
        if (await change.count()) await change.click()
        await search.fill(asset)
        await panel
          .getByRole('group', { name: 'Déjà à toi' })
          .getByRole('option')
          .filter({ hasText: asset })
          .first()
          .click()
      }
      await pickDate(panel, 'Date', on)
      if (quantity !== undefined)
        await panel.getByRole('textbox', { name: 'Quantité' }).fill(quantity.replace('.', ','))
      await panel.getByRole('textbox', { name: amountLabel(type) }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Déclarer', exact: true }).click()
      await settle(panel)
    },
    async correctOperation(ref, { amount, quantity, on }) {
      await exercised('correctOperationAction')
      await (await operationMenu(ref)).click()
      await page.getByRole('menuitem', { name: 'Corriger' }).click()
      const panel = page.getByRole('dialog', {
        name: `${TYPES[ref.type]} · ${ref.asset ?? 'frais de compte'}`,
      })
      if (on) await pickDate(panel, 'Date', on)
      if (quantity !== undefined)
        await panel.getByRole('textbox', { name: 'Quantité' }).fill(quantity.replace('.', ','))
      if (amount) await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
    },
    async deleteOperation(ref) {
      await exercised('deleteOperationAction')
      await (await operationMenu(ref)).click()
      await page.getByRole('menuitem', { name: 'Supprimer' }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click()
      await settle(dialog)
    },
    async readOperations() {
      await exercised('screen:/investments')
      await visit('/investments')
      const block = page.getByRole('region', { name: 'Opérations' })
      const rows = await block.getByRole('button', { name: /^Actions sur / }).evaluateAll((buttons) =>
        buttons.map((button) => {
          const cells = [...(button.closest('div.grid')?.children ?? [])]
          const subject = cells[2]?.firstElementChild
          const note = subject?.querySelector('span')?.textContent ?? ''
          const figures = [...(cells[3]?.children ?? [])]
          return {
            day: cells[0]?.textContent ?? '',
            type: cells[1]?.textContent ?? '',
            asset: (subject?.textContent ?? '').slice(0, (subject?.textContent ?? '').length - note.length),
            quantity: figures[0]?.textContent ?? '',
            amount: figures[1]?.textContent ?? '',
          }
        }),
      )
      const types = Object.fromEntries(Object.entries(TYPES).map(([type, label]) => [label, type]))
      return rows.map((row) => ({
        type: types[row.type] as OperationType,
        ...(row.asset && row.asset !== 'frais de compte' ? { asset: row.asset } : {}),
        ...(row.quantity ? { quantity: decimalOf(row.quantity) } : {}),
        amount: moneyOf(row.amount),
        on: dayOf(row.day),
      }))
    },
    async readPositions() {
      await exercised('screen:/investments')
      await visit('/investments')
      const block = page.getByRole('region', { name: 'Positions' })
      if ((await block.count()) === 0) return []
      const rows = await block.locator('a[href^="/investments/"]').evaluateAll((links) =>
        links.map((link) => {
          const cells = [...(link.parentElement?.children ?? [])]
          const figures = [...(cells[3]?.children ?? [])]
          return {
            asset: link.firstElementChild?.textContent ?? '',
            averageCost: link.textContent ?? '',
            quantity: cells[1]?.textContent ?? '',
            price: cells[2]?.textContent ?? '',
            value: figures[0]?.textContent ?? '',
            gain: figures[1]?.textContent ?? '',
          }
        }),
      )
      const orNull = (text: string, read: (t: string) => Money) => (text === '—' ? null : read(text))
      return rows.map((row) => {
        const averageCost = row.averageCost.match(/PRU ([^€]+€)/)?.[1]
        if (!averageCost) throw new Error(`no average cost on the line of ${row.asset}`)
        return {
          asset: row.asset,
          quantity: decimalOf(row.quantity),
          averageCost: moneyOf(averageCost),
          price: orNull(row.price, moneyOf),
          value: orNull(row.value, moneyOf),
          gain: orNull(row.gain, gainOf),
        }
      })
    },
    async readInvestmentAccounts() {
      await exercised('screen:/investments')
      await visit('/investments')
      const block = page.getByRole('region', { name: 'Comptes' })
      const figures = await block
        .locator('div.flex.min-w-0.flex-col')
        .evaluateAll((items) =>
          items.map((item) => [...item.querySelectorAll(':scope p')].map((p) => p.textContent ?? '')),
        )
      return figures.map(([account = '', value = '', note = '']) => {
        const worth = moneyOf(value)
        // The cash is said beside the worth: in hand, still to fund, or the
        // whole worth when nothing is held.
        const inCash = note.match(/^(.+€) en espèces$/)?.[1]
        const toFund = note.match(/^(.+€) à alimenter$/)?.[1]
        const cash = inCash ? moneyOf(inCash) : toFund ? moneyOf(`-${toFund}`) : worth
        return { account, cash, value: worth }
      })
    },
    async readValuationHistory() {
      await exercised('screen:/investments')
      // The curve, read at its two ends the way a person reads it: by
      // pointing at them. Each reading has its own chart.
      const read = async (chart: 'value' | 'performance') => {
        await visit(`/investments?chart=${chart}`)
        const wrap = page.getByRole('region', { name: 'Évolution' }).getByRole('img').locator('xpath=..')
        const box = await wrap.boundingBox()
        if (!box) throw new Error('the valuation chart is not drawn')
        const tip = wrap.locator('div.pointer-events-none')
        const at = async (x: number) => {
          await page.mouse.move(x, box.y + box.height / 2)
          return (await tip.innerText()).split('\n').filter(Boolean)
        }
        return { first: await at(box.x + 2), last: await at(box.x + box.width - 2) }
      }
      const value = await read('value')
      const performance = await read('performance')
      const day = (lines: string[], performanceLines: string[]) => {
        const figure = (from: string[], name: string) => {
          const at = from.indexOf(name)
          if (at === -1) throw new Error(`no ${name} in the chart's tooltip: ${from.join(' | ')}`)
          return moneyOf(from[at + 1] as string)
        }
        return {
          on: dayFromLong(lines[0] as string),
          value: figure(lines, 'Valorisation'),
          contributions: figure(lines, 'Apports'),
          performance: figure(performanceLines, 'Performance'),
        }
      }
      return { first: day(value.first, performance.first), last: day(value.last, performance.last) }
    },
  }
}

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

/** "1 juin 2026", the tooltip's long date, back to a day. */
function dayFromLong(text: string): string {
  const [date, month, year] = text.trim().split(/\s+/) as [string, string, string]
  const index = MONTHS.indexOf(month.toLowerCase())
  if (index === -1) throw new Error(`not a date: "${text}"`)
  return `${year}-${String(index + 1).padStart(2, '0')}-${date.padStart(2, '0')}`
}
