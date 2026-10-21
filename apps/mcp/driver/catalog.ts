import type { Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function catalogSteps({ call, batch }: McpContext): Partial<Steps> {
  return {
    async createCategory({ name, group }) {
      await call('manage_categories', { action: 'create', name, group })
    },
    async editCategory({ category, name, group }) {
      await call('manage_categories', {
        action: 'update',
        name: category,
        newName: name,
        group: group === null ? 'none' : group,
      })
    },
    async readCategories() {
      const { categories } = await call<{ categories: { name: string; group?: string }[] }>(
        'manage_categories',
        { action: 'list' },
      )
      return categories.map((c) => ({ name: c.name, group: c.group ?? null }))
    },
    async createActor(name) {
      await call('manage_actors', { action: 'create', name })
    },
    async editActor({ actor, name, activity }) {
      await call('manage_actors', {
        action: 'update',
        actor,
        newName: name,
        activity: activity === null ? 'none' : activity,
      })
    },
    async addAlias({ actor, alias }) {
      await call('manage_actors', { action: 'add_alias', actor, alias })
    },
    async mergeActors({ keep, absorb }) {
      await call('manage_actors', { action: 'merge', keep, absorb })
    },
    async reattachActorHistory(actor) {
      await call('manage_actors', { action: 'reattach_history', actor })
    },
    async readActors() {
      const actors = await call<{ name: string; activity?: string; aliases: string[] }[]>('manage_actors', {
        action: 'list',
      })
      return actors.map((a) => ({ name: a.name, activity: a.activity ?? null, aliases: a.aliases }))
    },
    async previewReattachActorHistory(actor) {
      const preview = await call<{ movementsToReattach: number; since?: string }>('manage_actors', {
        action: 'preview_reattach',
        actor,
      })
      return { movements: preview.movementsToReattach, since: preview.since ?? null }
    },
    async declareExpenseToUnknownPayee({ account, amount, payee, on }) {
      const line = { type: 'expense', date: on, amount: Number(amount.amount), account, actor: payee }
      // Refused first: this interface never creates an actor it was not asked to.
      const refusal = await batch('declare_movements', { movements: [line] }).then(
        () => null,
        (error: Error) => error.message,
      )
      if (refusal === null)
        throw new Error(`the expense to "${payee}" went through without creating it explicitly`)
      if (!refusal.startsWith(`Unknown actor "${payee}"`)) throw new Error(refusal)
      await batch('declare_movements', { movements: [line], createUnknownActors: true })
    },
  }
}
