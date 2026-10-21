import type { CaseUser, Driver, Steps } from '@abacus/use-case-language'
import { type Browser, type BrowserContext, chromium } from 'playwright'
import { accountsSteps } from './accounts.ts'
import { advancesSteps } from './advances.ts'
import { businessSteps } from './business.ts'
import { catalogSteps } from './catalog.ts'
import { commitmentsSteps } from './commitments.ts'
import { type WebEnvironment, webContext } from './context.ts'
import { identitySteps } from './identity.ts'
import { investmentsSteps } from './investments.ts'
import { ledgerSteps } from './ledger.ts'
import { reportingSteps } from './reporting.ts'

export { moneyOf, type WebEnvironment } from './context.ts'

/**
 * The web driver: plays each step in a real browser, by Playwright, against the
 * web app the suite serves, the way a person uses it: through the screens,
 * their labels and their roles, never by calling a server action. Each case
 * gets its own browser context, signed in with the case user's cookie, its
 * clock on the suite's day, and every request that is not local cut. Each
 * gesture notes the server action it triggers, for the coverage guards. The
 * steps live in one module per domain.
 *
 * The browser speaks French: the labels are those of the French catalog.
 */

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

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
      const ctx = webContext(page, env)
      const steps: Partial<Steps> = {
        ...ledgerSteps(ctx),
        ...accountsSteps(ctx),
        ...commitmentsSteps(ctx),
        ...advancesSteps(ctx),
        ...businessSteps(ctx),
        ...investmentsSteps(ctx),
        ...catalogSteps(ctx),
        ...reportingSteps(ctx),
        ...identitySteps(ctx),
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
