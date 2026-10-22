import { eur, type Money } from '@abacus/use-case-language'
import type { Locator, Page } from 'playwright'

/**
 * What every web step module gets: the page of the case, the suite's
 * configuration, and the gestures common to every screen. A step goes through
 * the screens as a person does, by their French labels and their roles.
 */
export interface WebContext {
  page: Page
  env: WebEnvironment
  /** Opens a screen of the app by its path. */
  visit(path: string): Promise<void>
  /** Picks a day in the calendar a date field opens. */
  pickDate(scope: Locator, label: string, day: string): Promise<void>
  /** After a submit: throws the form's refusal, returns on its acknowledgement or when the panel closes. */
  settle(panel: Locator): Promise<void>
}

export interface WebEnvironment {
  webUrl: string
  /** The MCP endpoint the suite serves, for what an AI client does once let in. */
  mcpUrl: string
  today: string
  timeoutMs: number
}

/** "1 000,00 €" or "−12,50 €" as the screen formats it, back to a decimal string. */
export function moneyOf(text: string): Money {
  const cleaned = text
    .replace(/[\s\u202f\u00a0€]/g, '')
    .replace('−', '-')
    .replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`not an amount: "${text}"`)
  return eur(Number(cleaned).toFixed(2))
}

/** A decimal string as a French keyboard types it. */
export const typed = (money: Money) => money.amount.replace('.', ',')

/** What Next renders in place of a page whose server code threw. */
const CRASHED = /This page couldn.t load|Application error/

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

/** "3 juin 2026", a day as the screens write it in full, back to "2026-06-03". */
export function longDay(text: string): string {
  const [date, month, year] = text.trim().split(/\s+/) as [string, string, string]
  const index = MONTHS.indexOf(month.toLowerCase())
  if (index === -1 || !/^\d{4}$/.test(year)) throw new Error(`not a long date: "${text}"`)
  return `${year}-${String(index + 1).padStart(2, '0')}-${date.padStart(2, '0')}`
}

export function webContext(page: Page, env: WebEnvironment): WebContext {
  return {
    page,
    env,
    async visit(path) {
      await page.goto(`${env.webUrl}${path}`)
    },
    async pickDate(scope, label, day) {
      await scope.getByRole('button', { name: label }).click()
      const [year, month, date] = day.split('-').map(Number) as [number, number, number]
      const calendar = page.getByRole('grid').last()
      const caption = () =>
        page
          .locator(
            '[role="dialog"] .rdp-caption_label, [data-radix-popper-content-wrapper] .rdp-caption_label',
          )
          .last()
          .innerText()
      for (let i = 0; i < 240; i++) {
        const [shownMonth, shownYear] = (await caption()).toLowerCase().split(' ')
        const shown = Number(shownYear) * 12 + MONTHS.indexOf(shownMonth as string)
        const wanted = year * 12 + month - 1
        if (shown === wanted) break
        await page
          .getByRole('button', { name: shown < wanted ? /suivant/i : /précédent/i })
          .last()
          .click()
      }
      await calendar
        .getByRole('button', { name: new RegExp(`\\b${date} ${MONTHS[month - 1]} ${year}`) })
        .click()
    },
    async settle(panel) {
      // Whichever comes first: the form's refusal (a field or the form in the
      // destructive colour, inside the form only: a panel may hold a danger
      // zone in that colour too), its acknowledgement (the polite "✓" line),
      // the panel closing on its own, or the page failing to render, which
      // also makes the panel go and must not pass for a success.
      const refusal = panel.locator('form .text-destructive').filter({ hasText: /\S/ })
      const done = panel.locator('[aria-live="polite"]').filter({ hasText: '✓' })
      const crashed = page.getByText(CRASHED)
      await Promise.race([
        refusal.first().waitFor(),
        done.first().waitFor(),
        panel.waitFor({ state: 'detached' }),
        crashed.first().waitFor(),
      ])
      if (await crashed.count())
        throw new Error(`the page failed to render: ${await crashed.first().innerText()}`)
      if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
    },
  }
}
