import { resolveSort } from '@abacus/core/domain/sort'
import {
  ACCOUNT_SORTS,
  closeAccount,
  createAccount,
  DEFAULT_ACCOUNT_SORT,
  editAccount,
  listAccounts,
  reopenAccount,
  sortAccounts,
} from '@abacus/core/services/accounts'
import { addAlias, createActor, editActor, listActors, mergeActors } from '@abacus/core/services/actors'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  CATEGORY_SORTS,
  createActivity,
  createCategory,
  DEFAULT_CATEGORY_SORT,
  editActivity,
  editCategory,
  listActivities,
  listCategories,
  sortCategories,
} from '@abacus/core/services/catalog'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireCategoryByName,
} from '../resolve.ts'
import { clearable, fail, isoDate, ok, orderedBy, run, sortDirection } from './shared.ts'

export function registerCatalogTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_accounts',
    {
      description:
        'Manages the user\'s accounts. Actions: list (with balances), create (behavior: payment = current account carrying daily spending, savings = savings book, investment = brokerage/crypto), update (correct the name, the institution, the behavior or the opening), close (the account keeps its history, it just stops accepting later movements), reopen (undo a close). An account that already existed before this ledger is declared with the money it already held: openingBalance on openedOn, never as a movement from an invented actor, which would show as a huge income that never happened. That opening is not a flow: no analysis counts it, and every balance starts from it, so the first balance check reports no gap. Accounts mirror the user\'s real banking setup: never create one without an explicit request, and correct a wrong one rather than adding a second, since closing and recreating would mean redeclaring its whole history. Every listed account carries lastCheckedOn, the day its balance was last confronted with reality: sortBy: checked puts the stalest first, which is how "what should I point" is answered, and the answer repeats the order used.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'close', 'reopen']),
        name: z
          .string()
          .optional()
          .describe('Every action except list: the account, by name (e.g. "Fortuneo checking")'),
        newName: z.string().optional().describe('update: the corrected name'),
        behavior: z.enum(['payment', 'savings', 'investment']).optional().describe('create/update'),
        institution: z
          .string()
          .optional()
          .describe('create/update: institution, free text, or "none" to clear it'),
        openingBalance: z
          .number()
          .optional()
          .describe(
            'create/update: what the account already held when the user started declaring, in euros. Negative if it was overdrawn. On an investment account this is the cash only; the positions already held are declared with record_investment_operations, as purchases at their real price and date. Requires openedOn.',
          ),
        openedOn: isoDate
          .optional()
          .describe(
            'create/update: the day the account opened, which is the day its opening balance counts from',
          ),
        closedOn: isoDate.optional().describe('close: defaults to today'),
        sortBy: z
          .enum(['name', 'balance', 'checked'])
          .optional()
          .describe(
            'list: what the list is ordered on. name (default), balance (biggest first), checked (the account whose balance check is oldest first, never checked ahead of them all)',
          ),
        direction: sortDirection,
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const sort = resolveSort(ACCOUNT_SORTS, DEFAULT_ACCOUNT_SORT, a.sortBy, a.direction)
          const accounts = await listAccounts(userId)
          // The day each one was last pointed comes along: it is what "checked"
          // ranks on, and an order whose criterion the answer does not show
          // could not be checked by whoever reads it.
          const checked = await Promise.all(
            accounts.map(async (account) => ({
              account,
              lastCheckedOn: (await latestCheck(userId, account.id))?.check.checkedOn ?? null,
            })),
          )
          return ok({
            order: orderedBy(sort),
            accounts: sortAccounts(checked, sort).map(({ account: acc, lastCheckedOn }) => ({
              name: acc.name,
              behavior: acc.behavior,
              institution: acc.institution ?? undefined,
              balance: Number(acc.balance),
              openingBalance: Number(acc.openingBalance) || undefined,
              openedOn: acc.openedOn ?? undefined,
              closedOn: acc.closedOn ?? undefined,
              lastCheckedOn: lastCheckedOn ?? 'never checked',
            })),
          })
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          if (!a.behavior) return fail('create requires behavior (payment, savings or investment).')
          const account = await createAccount({
            userId,
            name: a.name,
            behavior: a.behavior,
            institution: a.institution ?? null,
            openingBalance: a.openingBalance,
            openedOn: a.openedOn ?? null,
          })
          return ok({ accountId: account.id, name: account.name })
        }
        const account = await requireAccountByName(userId, a.name)
        if (a.action === 'update') {
          const updated = await editAccount(userId, account.id, {
            name: a.newName,
            institution: clearable(a.institution),
            behavior: a.behavior,
            openingBalance: a.openingBalance,
            openedOn: a.openedOn,
          })
          return ok({
            accountId: updated.id,
            name: updated.name,
            behavior: updated.behavior,
            institution: updated.institution ?? undefined,
            openingBalance: Number(updated.openingBalance) || undefined,
            openedOn: updated.openedOn ?? undefined,
          })
        }
        if (a.action === 'reopen') {
          const reopened = await reopenAccount(userId, account.id)
          return ok({ accountId: reopened.id, name: reopened.name, closedOn: null })
        }
        const closed = await closeAccount(userId, account.id, a.closedOn)
        return ok({ accountId: closed.id, closedOn: closed.closedOn })
      }),
  )

  server.registerTool(
    'manage_actors',
    {
      description:
        'Manages the actor referential (counterparties: merchants, clients, organizations, people). Actions: list, create (with aliases and an optional activity: an actor attached to an activity, e.g. a client attached to Freelance, passes that sphere to its movements), update (correct the canonical name, the activity or the note), add_alias ("Macdo" must resolve to McDonald\'s), merge (absorb a duplicate: all history moves to keep, the absorbed name becomes an alias). A corrected name replaces the former one, which stops resolving: that is what fixes a typo. A name that really was in use is kept with add_alias instead. The movements already written keep the activity they were written with. The cleanliness of this referential drives every analysis: merge duplicates as soon as they appear.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'add_alias', 'merge']),
        name: z.string().optional().describe('create: canonical name'),
        newName: z.string().optional().describe('update: the corrected canonical name'),
        aliases: z.array(z.string()).optional().describe('create: initial aliases'),
        activity: z
          .string()
          .optional()
          .describe('create/update: activity passed on to this actor\'s movements, or "none" to detach it'),
        note: z.string().optional().describe('create/update: free note, or "none" to clear it'),
        actor: z.string().optional().describe('update/add_alias: target actor'),
        alias: z.string().optional().describe('add_alias: the new alias'),
        keep: z.string().optional().describe('merge: the actor to keep'),
        absorb: z
          .string()
          .optional()
          .describe('merge: the duplicate to absorb (its name becomes an alias of keep)'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const [actors, activities] = await Promise.all([listActors(userId), listActivities(userId)])
          const activityName = new Map(activities.map((act) => [act.id, act.name]))
          return ok(
            actors.map((actor) => ({
              name: actor.name,
              activity: actor.activityId ? activityName.get(actor.activityId) : undefined,
              note: actor.note ?? undefined,
            })),
          )
        }
        if (a.action === 'create') {
          if (!a.name) return fail('create requires name.')
          const actor = await createActor(userId, {
            name: a.name,
            aliases: a.aliases,
            activityId: a.activity ? (await requireActivityByName(userId, a.activity)).id : undefined,
            note: a.note,
          })
          return ok({ actorId: actor.id, name: actor.name })
        }
        if (a.action === 'update') {
          if (!a.actor) return fail('update requires actor: the actor to correct.')
          const target = (await requireActorByName(userId, a.actor)).actor
          const activity = clearable(a.activity)
          const updated = await editActor(userId, target.id, {
            name: a.newName,
            activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
            note: clearable(a.note),
          })
          return ok({ actorId: updated.id, name: updated.name })
        }
        if (a.action === 'add_alias') {
          if (!a.actor || !a.alias) return fail('add_alias requires actor and alias.')
          const target = (await requireActorByName(userId, a.actor)).actor
          await addAlias(userId, target.id, a.alias)
          return ok({ actor: target.name, alias: a.alias })
        }
        if (!a.keep || !a.absorb) return fail('merge requires keep and absorb.')
        const keep = (await requireActorByName(userId, a.keep)).actor
        const absorb = (await requireActorByName(userId, a.absorb)).actor
        const merged = await mergeActors(userId, keep.id, absorb.id)
        return ok({
          kept: merged.name,
          absorbed: absorb.name,
          note: `"${absorb.name}" is now an alias of "${merged.name}".`,
        })
      }),
  )

  server.registerTool(
    'manage_categories',
    {
      description:
        "Manages expense and income categories (the user's vocabulary, flat, with an optional group). Actions: list, create, update (rename it, or change its group). Renaming propagates on its own: the movements filed under a category point at it, not at its name. Never invent a category close to an existing one: list first, and ask the user when in doubt. Internal transfers never have a category. list comes back grouped, then alphabetical inside each group, the order the user reads them in; sortBy: name lists them flat instead, and the answer repeats the order used.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update']),
        sortBy: z
          .enum(['group', 'name'])
          .optional()
          .describe('list: grouped (default) or alphabetical; the group order lists what is filed together'),
        direction: sortDirection,
        name: z.string().optional().describe('create: the name; update: the category to correct'),
        newName: z.string().optional().describe('update: the corrected name'),
        group: z
          .string()
          .optional()
          .describe('create/update: optional group (e.g. "Everyday life"), or "none" to clear it'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const categories = await listCategories(userId)
          const sort = resolveSort(CATEGORY_SORTS, DEFAULT_CATEGORY_SORT, a.sortBy, a.direction)
          return ok({
            order: orderedBy(sort),
            categories: sortCategories(categories, sort).map((c) => ({
              name: c.name,
              group: c.groupLabel ?? undefined,
            })),
          })
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          const category = await createCategory(userId, a.name, a.group)
          return ok({ categoryId: category.id, name: category.name })
        }
        const target = await requireCategoryByName(userId, a.name)
        const updated = await editCategory(userId, target.id, {
          name: a.newName,
          groupLabel: clearable(a.group),
        })
        return ok({ categoryId: updated.id, name: updated.name, group: updated.groupLabel ?? undefined })
      }),
  )

  server.registerTool(
    'manage_activities',
    {
      description:
        'Manages activities: the user\'s economic spheres (e.g. "Freelance"). A movement without an activity is personal. An activity attaches to the relevant actors (clients, tax agencies) and passes on to their movements; that is what carries per-activity revenue and charges tracking. Actions: list, create, update (rename it: what is filed under it stays filed under it). Create very few: it partitions the finances, it is not a tag system.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update']),
        name: z.string().optional().describe('create: the name; update: the activity to rename'),
        newName: z.string().optional().describe('update: the corrected name'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const activities = await listActivities(userId)
          return ok(activities.map((act) => act.name))
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          const activity = await createActivity(userId, a.name)
          return ok({ activityId: activity.id, name: activity.name })
        }
        if (!a.newName) return fail('update requires newName: the corrected name.')
        const target = await requireActivityByName(userId, a.name)
        const updated = await editActivity(userId, target.id, a.newName)
        return ok({ activityId: updated.id, name: updated.name })
      }),
  )
}
