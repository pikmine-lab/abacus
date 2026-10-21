import {
  type CaseUser,
  type Driver,
  eur,
  type Money,
  recordExercised,
  type Steps,
} from '@abacus/use-case-language'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'

/**
 * The web driver: plays each step in a real browser, by Playwright, against the
 * web app the suite serves, the way a person uses it: through the screens,
 * their labels and their roles, never by calling a server action. Each case
 * gets its own browser context, signed in with the case user's cookie, its
 * clock on the suite's day, and every request that is not local cut. Each
 * gesture notes the server action it triggers, for the coverage guards.
 *
 * The browser speaks French: the labels below are those of the French catalog.
 */

export interface WebEnvironment {
  webUrl: string
  today: string
  timeoutMs: number
}

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** "1 000,00 €" or "−12,50 €" as the screen formats it, back to a decimal string. */
export function moneyOf(text: string): Money {
  const cleaned = text
    .replace(/[\s  €]/g, '')
    .replace('−', '-')
    .replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`not an amount: "${text}"`)
  return eur(Number(cleaned).toFixed(2))
}

/** A decimal string as a French keyboard types it. */
const typed = (money: Money) => money.amount.replace('.', ',')

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

export function webDriver(env: WebEnvironment): Driver {
  let browser: Browser | undefined

  async function signedIn(user: CaseUser): Promise<BrowserContext> {
    browser ??= await chromium.launch()
    const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' })
    context.setDefaultTimeout(env.timeoutMs)
    await context.clock.install({ time: new Date(`${env.today}T12:00:00`) })
    await context.route('**/*', (route) =>
      LOCAL.has(new URL(route.request().url()).hostname) ? route.continue() : route.abort(),
    )
    const host = new URL(env.webUrl).hostname
    await context.addCookies(
      user.cookie.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: host, path: '/' }
      }),
    )
    return context
  }

  return {
    name: 'web',
    async open(user) {
      const context = await signedIn(user)
      const page = await context.newPage()

      async function visit(path: string): Promise<void> {
        await page.goto(`${env.webUrl}${path}`)
      }

      /** Picks a day in the calendar a date field opens, moving month by month. */
      async function pickDate(
        scope: ReturnType<Page['getByRole']>,
        label: string,
        day: string,
      ): Promise<void> {
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
      }

      const steps: Partial<Steps> = {
        async declareExpense({ account, amount, payee, on }) {
          await recordExercised({ driver: 'web', name: 'declareMovementAction' })
          await visit('/movements')
          await page.getByRole('button', { name: 'Déclarer', exact: true }).click()
          const panel = page.getByRole('dialog', { name: 'Déclarer un mouvement' })
          await pickDate(panel, 'Date', on)
          await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
          await panel.getByRole('combobox', { name: 'Compte débité' }).click()
          await page.getByRole('option', { name: account, exact: true }).click()
          await panel.getByRole('combobox', { name: 'Payé à (acteur)' }).fill(payee)
          await panel.getByRole('combobox', { name: 'Payé à (acteur)' }).press('Tab')
          await panel.getByRole('button', { name: 'Déclarer', exact: true }).click()
          await refusalOrSuccess(panel)
        },
        async readAccountBalance(account) {
          await visit('/accounts')
          const row = page
            .getByRole('button', { name: `Actions sur ${account}`, exact: true })
            .locator('xpath=ancestor::*[contains(normalize-space(.), "€")][1]')
          const text = await row.innerText()
          const amounts = text.match(/−?-?[\d\s  ]+,\d{2}\s?€/g)
          if (!amounts) throw new Error(`no balance on the row of "${account}": ${text}`)
          return moneyOf(amounts[amounts.length - 1] as string)
        },
      }

      /**
       * After a submit, whichever comes first: the form's refusal (a field or the
       * form in the destructive colour), its acknowledgement (the polite "✓"
       * line), or the panel closing on its own.
       */
      async function refusalOrSuccess(panel: ReturnType<Page['getByRole']>): Promise<void> {
        const refusal = panel.locator('.text-destructive').filter({ hasText: /\S/ })
        const done = panel.locator('[aria-live="polite"]').filter({ hasText: '✓' })
        await Promise.race([
          refusal.first().waitFor(),
          done.first().waitFor(),
          panel.waitFor({ state: 'detached' }),
        ])
        if (await refusal.count()) throw new Error((await refusal.allInnerTexts()).join(' ').trim())
      }

      // A failed step leaves a picture of the screen it failed on, when the
      // suite names a folder for them.
      const shots = process.env.ABACUS_CASES_ARTIFACTS
      const pictured = Object.fromEntries(
        Object.entries(steps).map(([name, step]) => [
          name,
          async (...args: unknown[]) => {
            try {
              return await (step as (...a: unknown[]) => Promise<unknown>)(...args)
            } catch (error) {
              if (shots)
                await page
                  .screenshot({ path: `${shots}/${user.id}-${name}.png`, fullPage: true })
                  .catch(() => {})
              throw error
            }
          },
        ]),
      ) as Partial<Steps>

      return { steps: pictured, close: () => context.close() }
    },
    async shutdown() {
      await browser?.close()
    },
  }
}
