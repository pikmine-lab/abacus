import { readingPreference, setReadingPreference } from '@abacus/core/services/preferences'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { fail, ok, run } from './shared.ts'

export function registerPreferenceTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_preferences',
    {
      description:
        'What the user has settled once and never has to say again. Today that is reading: which of the two readings of a month they count in, and therefore what analyze_flows and list_movements answer in when no reading is passed. Actions: show (what they count in right now), update (only when the user says how they want to count from now on). Read it before presenting figures you did not choose a reading for, so you can name the one they are in. Never update it to make one question easier: it changes every later answer, and the user did not ask for that. Changing it moves nothing in the ledger, the same movements are read the other way.',
      inputSchema: z.object({
        action: z.enum(['show', 'update']),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'update: cash, every movement counts on the day the money moved, which is what the bank statement says. accrual, a movement attached to another month counts in that month, which is what makes a month comparable to the next when a salary lands late or a rent is paid ahead',
          ),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'show') return ok({ reading: await readingPreference(userId) })
        if (!a.reading) return fail('Say which reading to settle on: cash or accrual.')
        return ok({ reading: await setReadingPreference(userId, a.reading) })
      }),
  )
}
