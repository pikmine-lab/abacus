import { listJurisdictions, previewRegime, questionnaire } from '@abacus/core/services/regimes'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { fail, ok, run } from './shared.ts'

/**
 * The catalog as an AI reads it. Everything this tool says about a model comes
 * from data files; the descriptions here only teach how to use one, which is
 * the part an AI gets wrong on its own: taking a shipped model for a truth,
 * answering the questionnaire in the user's place, and creating rules without
 * saying which of them no text confirms.
 */
export function registerRegimeTools(server: McpServer): void {
  server.registerTool(
    'browse_regimes',
    {
      description:
        "Browses the regime models shipped with abacus and walks the questionnaire that leads to one. A model is a starting point, dated and sourced, never a truth: it was read from official texts on one day, and texts change. What it creates is a copy the user owns; correcting the catalog later never reaches an activity already created, and correcting a rule never reaches the catalog. Actions: jurisdictions (the places the catalog covers and the models each holds), questions (the next question to put to the user given the answers so far, and the models those answers still allow), preview (everything a model would write, writing none of it). Walk it: call questions with no answers, put the question to the user in their own words, add their answer, call again, until it answers done: true. Never answer for them and never guess: every question is something only they know (the nature of their activity, an option they took, how often they file). Then call preview and read it back before anything is created. Each rule carries its source, the day it was checked and a status: confirmed when a text in force fixes the value, extended_by_default when a lapsed text is still being applied, unconfirmed when no text fixes it at all. Say those statuses out loud, name the rules that will need a figure only the user has (a notice's amount, the contribution base they chose), and tell them the rules are theirs to correct with manage_levies. When they agree, create the activity with manage_activities (action create, with regime and answers). A place the catalog does not cover is not a dead end: create the activity by hand and write its rules with manage_levies, citing the texts.",
      inputSchema: z.object({
        action: z.enum(['jurisdictions', 'questions', 'preview']),
        jurisdiction: z
          .string()
          .optional()
          .describe('questions: the jurisdiction id, as action jurisdictions returns it'),
        model: z.string().optional().describe('preview: the model id, unique across the catalog'),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'questions/preview: the answers given so far, one option value per question id. This is the whole state: send them all back on every call, and drop one to go back a step',
          ),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'jurisdictions') return ok(listJurisdictions())
        if (a.action === 'questions') {
          if (!a.jurisdiction)
            return fail('questions requires jurisdiction: the id from action jurisdictions.')
          const step = questionnaire(a.jurisdiction, a.answers ?? {})
          return ok({
            jurisdiction: step.jurisdiction,
            answers: step.answers,
            done: step.done,
            question: step.question ?? undefined,
            models: step.models,
          })
        }
        if (!a.model) return fail('preview requires model: the id from action jurisdictions.')
        const preview = previewRegime(a.model, a.answers ?? {})
        // What the AI must repeat to the user before it creates anything: the
        // values no text in force confirms, and the figures the model cannot
        // know. Everything else is in the rules below it.
        const unconfirmed = [
          ...preview.levies.flatMap(({ levy, modifiers }) => [
            { name: levy.name, status: levy.status, source: levy.sourceUrl },
            ...modifiers.map((m) => ({ name: m.label, status: m.status, source: m.sourceUrl })),
          ]),
          ...preview.thresholds.map((t) => ({ name: t.label, status: t.status, source: t.sourceUrl })),
        ].filter((entry) => entry.status !== undefined && entry.status !== 'confirmed')
        return ok({
          jurisdiction: preview.jurisdiction,
          model: preview.model,
          activity: preview.activity,
          rules: preview.levies.map(({ levy, modifiers }) => ({
            ...levy,
            modifiers: modifiers.length > 0 ? modifiers : undefined,
          })),
          thresholds: preview.thresholds,
          statedFigures: preview.inputs,
          toAnnounce: unconfirmed,
        })
      }),
  )
}
