import type { Steps } from '@abacus/use-case-language'
import {
  addAlias,
  createActor,
  editActor,
  listActors,
  mergeActors,
  reattachActorHistory,
} from '../src/services/actors.ts'
import {
  createCategory,
  editCategory,
  listActivities,
  listCategories,
  sortByName,
  sortCategories,
} from '../src/services/catalog.ts'
import { declareMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

export function catalogSteps({ user, accountId }: PreparationContext): Partial<Steps> {
  async function actor(name: string) {
    const found = (await listActors(user.id)).find((a) => a.name === name)
    if (!found) throw new Error(`no actor named "${name}"`)
    return found
  }

  async function activityId(name: string | null | undefined): Promise<string | null | undefined> {
    if (!name) return name
    const found = (await listActivities(user.id)).find((a) => a.name === name)
    if (!found) throw new Error(`no activity named "${name}"`)
    return found.id
  }

  return {
    async createCategory({ name, group }) {
      await createCategory(user.id, name, group)
    },
    async editCategory({ category, name, group }) {
      const found = (await listCategories(user.id)).find((c) => c.name === category)
      if (!found) throw new Error(`no category named "${category}"`)
      await editCategory(user.id, found.id, { name, groupLabel: group })
    },
    async readCategories() {
      return sortCategories(await listCategories(user.id)).map((c) => ({ name: c.name, group: c.groupLabel }))
    },
    async createActor(name) {
      await createActor(user.id, { name })
    },
    async editActor({ actor: name, name: newName, activity }) {
      const found = await actor(name)
      await editActor(user.id, found.id, { name: newName, activityId: await activityId(activity) })
    },
    async addAlias({ actor: name, alias }) {
      await addAlias(user.id, (await actor(name)).id, alias)
    },
    async mergeActors({ keep, absorb }) {
      await mergeActors(user.id, (await actor(keep)).id, (await actor(absorb)).id)
    },
    async reattachActorHistory(name) {
      await reattachActorHistory(user.id, (await actor(name)).id, {})
    },
    async readActors() {
      const activities = new Map((await listActivities(user.id)).map((a) => [a.id, a.name]))
      return sortByName(await listActors(user.id)).map((a) => ({
        name: a.name,
        activity: a.activityId ? (activities.get(a.activityId) ?? null) : null,
      }))
    },
    async declareExpenseToUnknownPayee({ account, amount, payee, on }) {
      const created = await createActor(user.id, { name: payee })
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: await accountId(account),
        targetActorId: created.id,
      })
    },
  }
}
