import { randomBytes } from 'node:crypto'
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
    // A client address of its own per case: the auth server limits sign-ins
    // and sign-ups per address, read from x-forwarded-for.
    const [a, b, c] = randomBytes(3)
    const context = await browser.newContext({
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      extraHTTPHeaders: { 'x-forwarded-for': `10.${a}.${b}.${c}` },
    })
    context.setDefaultTimeout(env.timeoutMs)
    // The page's clock moves by the same offset as this process's, which the
    // preloaded module shifted to the suite's day: performance does not move.
    // Playwright's own clock is not used: driven from a process whose Date is
    // shifted, it stops firing the page's timers.
    const offset = Date.now() - (performance.timeOrigin + performance.now())
    await context.addInitScript((shift: number) => {
      const RealDate = Date
      function ShiftedDate(this: unknown, ...args: unknown[]) {
        if (new.target === undefined) return new RealDate(RealDate.now() + shift).toString()
        return Reflect.construct(RealDate, args.length === 0 ? [RealDate.now() + shift] : args, new.target)
      }
      ShiftedDate.prototype = RealDate.prototype
      ShiftedDate.now = () => RealDate.now() + shift
      ShiftedDate.parse = RealDate.parse
      ShiftedDate.UTC = RealDate.UTC
      globalThis.Date = ShiftedDate as unknown as DateConstructor
    }, offset)
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
