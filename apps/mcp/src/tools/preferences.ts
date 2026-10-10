import { LANGUAGES } from '@abacus/core/domain'
import {
  languagePreference,
  rankingViewPreference,
  readingPreference,
  setLanguagePreference,
  setRankingViewPreference,
  setReadingPreference,
} from '@abacus/core/services/preferences'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { fail, ok, run } from './shared.ts'

export function registerPreferenceTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_preferences',
    {
      description:
        "What the user has settled once and never has to say again. reading: which of the two readings of a month they count in, and therefore what analyze_flows and list_movements answer in when no reading is passed. rankingView: how the web app's Analyse screen draws its ranking; it changes no figure and nothing you read. language: the language the web app speaks to the user; it never translates their data, and you keep talking to them in whatever language they use with you. Actions: show (all three, as they are right now), update (only what the user says they want from now on; pass only that one). Read it before presenting figures you did not choose a reading for, so you can name the one they are in. Never update reading to make one question easier: it changes every later answer, and the user did not ask for that. Changing any of them moves nothing in the ledger.",
      inputSchema: z.object({
        action: z.enum(['show', 'update']),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'update: cash, every movement counts on the day the money moved, which is what the bank statement says. accrual, a movement attached to another month counts in that month, which is what makes a month comparable to the next when a salary lands late or a rent is paid ahead',
          ),
        rankingView: z
          .enum(['strip', 'bars'])
          .optional()
          .describe(
            'update: strip, the period as one bar cut into shares with the list and each share in percent underneath. bars, one bar per line, which compares neighbouring lines more finely',
          ),
        language: z
          .enum([...LANGUAGES, 'browser'])
          .optional()
          .describe(
            `update: ${LANGUAGES.join(', ')}, the web app speaks that language whatever the browser says. browser, the choice is handed back and the web app follows the language the browser asks for. show answers null for browser`,
          ),
      }),
    },
    async (a) =>
      run(async () => {
        const current = async () => ({
          reading: await readingPreference(userId),
          rankingView: await rankingViewPreference(userId),
          language: await languagePreference(userId),
        })
        if (a.action === 'show') return ok(await current())
        if (!a.reading && !a.rankingView && !a.language)
          return fail(
            `Say what to settle: reading (cash or accrual), rankingView (strip or bars) or language (${LANGUAGES.join(', ')} or browser).`,
          )
        if (a.reading) await setReadingPreference(userId, a.reading)
        if (a.rankingView) await setRankingViewPreference(userId, a.rankingView)
        if (a.language) await setLanguagePreference(userId, a.language === 'browser' ? null : a.language)
        return ok(await current())
      }),
  )
}
