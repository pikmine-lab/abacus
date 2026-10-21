import type { FlowDimension, Language, Steps } from '@abacus/use-case-language'
import { moneyOf, type WebContext } from './context.ts'

/** What the ranking calls the rows that carry no category, no actor, no activity, no group. */
const UNSET = new Set(['Sans catégorie', 'Sans acteur', 'Hors activité', 'Sans groupe'])

const DIMENSIONS: Record<FlowDimension, string> = {
  category: 'catégorie',
  categoryGroup: 'groupe',
  actor: 'acteur',
  activity: 'activité',
}

const LANGUAGES: Record<string, Language> = { Navigateur: null, Browser: null, Français: 'fr', English: 'en' }

export function reportingSteps({ page, visit, exercised }: WebContext): Partial<Steps> {
  /** The two tablists of the preferences, by their place: the reading, then the ranking's drawing. */
  async function preferences() {
    await visit('/settings?part=preferences')
    const tabs = page.getByRole('main').getByRole('tablist')
    await tabs.nth(1).waitFor()
    return { reading: tabs.nth(0), ranking: tabs.nth(1) }
  }

  /** Clicks a tab that writes a preference on its own, and waits for the write. */
  async function choose(tab: ReturnType<typeof page.getByRole>) {
    const written = page.waitForResponse((r) => r.request().method() === 'POST')
    await tab.click()
    await written
  }

  return {
    async readFlows({ kind, by, month }) {
      await exercised('screen:/analysis')
      await visit(`/analysis?period=month&ref=${month}&by=${by}&flow=${kind}`)
      const section = page.getByRole('region', {
        name: `${kind === 'income' ? 'Revenus' : 'Dépenses'} par ${DIMENSIONS[by]}`,
      })
      const rows = await section.locator(':scope > div.pt-3 > :last-child').evaluate((ranking) =>
        ranking.tagName === 'P'
          ? []
          : [...ranking.children].map((child) => {
              const row = child.tagName === 'DETAILS' ? child.querySelector('summary') : child
              const cells = [...(row?.children ?? [])]
              return {
                label: cells[0]?.textContent ?? '',
                amount: cells[cells.length - 1]?.textContent ?? '',
              }
            }),
      )
      return rows.map((row) => ({
        label: UNSET.has(row.label) ? null : row.label,
        amount: moneyOf(row.amount),
      }))
    },
    async readWealth() {
      await exercised('screen:/')
      await visit('/')
      const figure = page.getByRole('link', { name: /^Patrimoine/ })
      return moneyOf((await figure.getByRole('paragraph').nth(1).textContent()) ?? '')
    },
    async readPreferences() {
      await exercised('screen:/settings')
      const { reading, ranking } = await preferences()
      const selected = async (list: typeof reading) =>
        list
          .getByRole('tab')
          .evaluateAll((tabs) => tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'))
      // The choice is written into the trigger once the control has mounted.
      const trigger = page.getByRole('main').getByRole('combobox').filter({ hasText: /\S/ })
      await trigger.waitFor()
      const language = ((await trigger.textContent()) ?? '').trim()
      if (!(language in LANGUAGES)) throw new Error(`not a language choice: "${language}"`)
      return {
        reading: (await selected(reading)) === 1 ? 'accrual' : 'cash',
        rankingView: (await selected(ranking)) === 1 ? 'bars' : 'strip',
        language: LANGUAGES[language] ?? null,
      }
    },
    async setReadingPreference(value) {
      await exercised('setReadingPreferenceAction')
      const { reading } = await preferences()
      await choose(reading.getByRole('tab').nth(value === 'accrual' ? 1 : 0))
    },
    async setRankingViewPreference(view) {
      await exercised('setRankingViewPreferenceAction')
      const { ranking } = await preferences()
      await choose(ranking.getByRole('tab').nth(view === 'bars' ? 1 : 0))
    },
    async setLanguagePreference(language) {
      await exercised('setLanguagePreferenceAction')
      await preferences()
      await page.getByRole('main').getByRole('combobox').click()
      // The choice is named in the language the screen speaks at that moment.
      const names = Object.keys(LANGUAGES).filter((name) => LANGUAGES[name] === language)
      await choose(page.getByRole('option', { name: new RegExp(`^(${names.join('|')})$`) }))
    },
  }
}
