import type { Activity } from '@abacus/core/domain'
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
import {
  addAlias,
  createActor,
  editActor,
  listActors,
  mergeActors,
  reattachActorHistory,
} from '@abacus/core/services/actors'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  CATEGORY_SORTS,
  closeActivity,
  createActivity,
  createCategory,
  DEFAULT_CATEGORY_SORT,
  editActivity,
  editCategory,
  listActivities,
  listActivityAccounts,
  listCategories,
  listCategoryExceptions,
  reopenActivity,
  setActivityAccounts,
  setActivityCategoryExceptions,
  sortCategories,
} from '@abacus/core/services/catalog'
import { applyRegime } from '@abacus/core/services/regimes'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireCategoryByName,
} from '../resolve.ts'
import { clearable, fail, isoDate, ok, orderedBy, run, sortDirection } from './shared.ts'

/** A percentage the AI may clear by passing null. */
const rate = z.number().min(0).max(100).nullable().optional()

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value)
}

/**
 * An activity as the AI reads it. A personal activity is its name and kind:
 * the regime fields describe a business, and would be noise on a sphere that
 * has none.
 */
function describeActivity(act: Activity, exceptions: string[], accounts: string[]) {
  const base = {
    name: act.name,
    kind: act.kind,
    startedOn: act.startedOn ?? undefined,
    closedOn: act.closedOn ?? undefined,
  }
  if (act.kind === 'personal') return base
  return {
    ...base,
    accounts,
    jurisdiction: act.jurisdiction ?? undefined,
    regimeLabel: act.regimeLabel ?? undefined,
    fiscalYearStart: `${String(act.fiscalYearStartMonth).padStart(2, '0')}-${String(act.fiscalYearStartDay).padStart(2, '0')}`,
    revenueBasis: act.revenueBasis,
    vatRegistered: act.vatRegistered,
    defaultVatRate: act.defaultVatRate !== null ? Number(act.defaultVatRate) : undefined,
    deductibleExpenses: act.deductibleExpenses,
    categoryExceptions: exceptions,
    currency: act.currency,
  }
}

export function registerCatalogTools(server: McpServer, userId: string): void {
  /** The exception categories of one activity, by the names the user gave them. */
  async function exceptionNames(activityId: string): Promise<string[]> {
    const [exceptions, categories] = await Promise.all([
      listCategoryExceptions(userId),
      listCategories(userId),
    ])
    const categoryName = new Map(categories.map((c) => [c.id, c.name]))
    return exceptions
      .filter((e) => e.activityId === activityId)
      .map((e) => categoryName.get(e.categoryId)!)
      .sort()
  }

  /** The accounts one activity lives on, by the names the user gave them. */
  async function accountNames(activityId: string): Promise<string[]> {
    const [links, accounts] = await Promise.all([listActivityAccounts(userId), listAccounts(userId)])
    const accountName = new Map(accounts.map((acc) => [acc.id, acc.name]))
    return links
      .filter((l) => l.activityId === activityId)
      .map((l) => accountName.get(l.accountId)!)
      .sort()
  }

  /**
   * A regime model decides what it decides. Passing one of those settings
   * beside it would state two answers to the same question, and the one that
   * lost would be dropped without a word.
   */
  const DECIDED_BY_MODEL = [
    'kind',
    'fiscalYearStartMonth',
    'fiscalYearStartDay',
    'revenueBasis',
    'vatRegistered',
    'defaultVatRate',
    'deductibleExpenses',
    'regimeLabel',
    'jurisdiction',
    'currency',
  ] as const

  async function createFromRegime(
    modelId: string,
    name: string,
    args: Record<string, unknown>,
    accountIds: string[] | undefined,
  ) {
    const stated = DECIDED_BY_MODEL.filter((key) => args[key] !== undefined)
    if (stated.length > 0)
      return fail(
        `The regime model decides ${stated.join(', ')}: drop them here. Once the activity exists, correct any of them with action update.`,
      )
    const applied = await applyRegime(userId, {
      name,
      modelId,
      answers: (args.answers as Record<string, string> | undefined) ?? {},
      startedOn: args.startedOn as string | undefined,
      accountIds,
    })
    return ok({
      activityId: applied.activity.id,
      ...describeActivity(applied.activity, [], (args.accounts as string[] | undefined) ?? []),
      rules: applied.levies.map((levy) => ({
        name: levy.name,
        status: levy.status,
        source: levy.sourceUrl ?? undefined,
        checkedOn: levy.verifiedOn ?? undefined,
      })),
      thresholds: applied.thresholds.map((threshold) => threshold.label),
      statedFigures: applied.inputs.map((stated) => ({ name: stated.name, value: Number(stated.value) })),
      copied:
        "These rules are the activity's own from now on: the catalog will never change them, and manage_levies corrects or supersedes any of them. Tell the user which ones are not confirmed, and which stated figures they must replace with their real ones (set_activity_inputs).",
    })
  }

  server.registerTool(
    'manage_accounts',
    {
      description:
        'Manages the user\'s accounts. Actions: list (with balances), create (behavior: payment = current account carrying daily spending, savings = savings book, investment = brokerage/crypto), update (correct the name, the institution, the behavior or the opening), close (the account keeps its history, it just stops accepting later movements), reopen (undo a close). An account that already existed before this ledger is declared with the money it already held: openingBalance on openedOn, never as a movement from an invented actor, which would show as a huge income that never happened. That opening is not a flow: no analysis counts it, and every balance starts from it, so the first balance check reports no gap. An account is never attached to an activity from here: an account exists before the activities that use it, and several of them may live on the same one, so it is the activity that declares what it lives on (manage_activities, accounts). Each listed account answers with the activities living on it, if any. Accounts mirror the user\'s real banking setup: never create one without an explicit request, and correct a wrong one rather than adding a second, since closing and recreating would mean redeclaring its whole history. Every listed account carries lastCheckedOn, the day its balance was last confronted with reality: sortBy: checked puts the stalest first, which is how "what should I point" is answered, and the answer repeats the order used.',
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
          const [accounts, activities, links] = await Promise.all([
            listAccounts(userId),
            listActivities(userId),
            listActivityAccounts(userId),
          ])
          const activityName = new Map(activities.map((act) => [act.id, act.name]))
          // An account carries as many activities as live on it, so the answer
          // says all of them: naming one would hide the sharing, which is
          // exactly what changes how its balance may be read.
          const livingOn = (accountId: string) =>
            links
              .filter((l) => l.accountId === accountId)
              .map((l) => activityName.get(l.activityId)!)
              .sort()
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
            accounts: sortAccounts(checked, sort).map(({ account: acc, lastCheckedOn }) => {
              const living = livingOn(acc.id)
              return {
                name: acc.name,
                behavior: acc.behavior,
                institution: acc.institution ?? undefined,
                activities: living.length > 0 ? living : undefined,
                balance: Number(acc.balance),
                openingBalance: Number(acc.openingBalance) || undefined,
                openedOn: acc.openedOn ?? undefined,
                closedOn: acc.closedOn ?? undefined,
                lastCheckedOn: lastCheckedOn ?? 'never checked',
              }
            }),
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
        "Manages the actor referential (counterparties: merchants, clients, organizations, people). Actions: list, create (with aliases and an optional activity: an actor attached to an activity, e.g. a client attached to a freelance activity, passes that sphere to its movements), update (correct the canonical name, the activity, the note or the invoicing defaults), add_alias (\"Macdo\" must resolve to McDonald's), merge (absorb a duplicate: all history moves to keep, the absorbed name becomes an alias), reattach_history (move the actor's past movements onto its current activity). A client of a business activity carries what it does to an invoice: the VAT it bears (invoiceVatRate, 0 for a business abroad or intra-EU) and the share it withholds and pays to the tax office in the user's name (invoiceWithholdingRate); both are percentages copied onto a new invoice as its defaults, and both depend on the payer, which is why they live here and not on the activity. A corrected name replaces the former one, which stops resolving: that is what fixes a typo. A name that really was in use is kept with add_alias instead. The movements already written keep the activity they were written with: attaching an activity to an actor never reclassifies its history as a side effect, because a movement may carry an activity the user set on purpose. update answers movementsLeftBehind, the past movements that still carry what the actor passed on before (no activity, or its former one): tell the user, and on their say-so call reattach_history, which takes exactly those (optionally from a date) and never a movement set to another activity. The cleanliness of this referential drives every analysis: merge duplicates as soon as they appear.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'add_alias', 'merge', 'reattach_history']),
        name: z.string().optional().describe('create: canonical name'),
        newName: z.string().optional().describe('update: the corrected canonical name'),
        aliases: z.array(z.string()).optional().describe('create: initial aliases'),
        activity: z
          .string()
          .optional()
          .describe('create/update: activity passed on to this actor\'s movements, or "none" to detach it'),
        note: z.string().optional().describe('create/update: free note, or "none" to clear it'),
        invoiceVatRate: rate.describe(
          'create/update: percent of VAT this client bears on an invoice, proposed on each new one; null to clear',
        ),
        invoiceWithholdingRate: rate.describe(
          "create/update: percent this client keeps back from an invoice and pays to the tax office in the user's name; null to clear",
        ),
        actor: z.string().optional().describe('update/add_alias/reattach_history: target actor'),
        from: isoDate.optional().describe('reattach_history: only the movements from this day on'),
        previousActivity: z
          .string()
          .optional()
          .describe(
            'reattach_history: the activity the actor was attached to before the change, as update knew it. The movements still carrying it were inheriting it and come along; without it, only the movements carrying no activity are taken.',
          ),
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
              invoiceVatRate: actor.invoiceVatRate !== null ? Number(actor.invoiceVatRate) : undefined,
              invoiceWithholdingRate:
                actor.invoiceWithholdingRate !== null ? Number(actor.invoiceWithholdingRate) : undefined,
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
            invoiceVatRate: a.invoiceVatRate,
            invoiceWithholdingRate: a.invoiceWithholdingRate,
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
            invoiceVatRate: a.invoiceVatRate,
            invoiceWithholdingRate: a.invoiceWithholdingRate,
          })
          return ok({
            actorId: updated.id,
            name: updated.name,
            invoiceVatRate: numberOrNull(updated.invoiceVatRate) ?? undefined,
            invoiceWithholdingRate: numberOrNull(updated.invoiceWithholdingRate) ?? undefined,
            movementsLeftBehind: updated.leftBehind,
            note:
              updated.leftBehind > 0
                ? await leftBehindNote(userId, updated.name, updated.leftBehind, target.activityId)
                : undefined,
          })
        }
        if (a.action === 'reattach_history') {
          if (!a.actor) return fail('reattach_history requires actor.')
          const target = (await requireActorByName(userId, a.actor)).actor
          const moved = await reattachActorHistory(userId, target.id, {
            from: a.from,
            previousActivityId: a.previousActivity
              ? (await requireActivityByName(userId, a.previousActivity)).id
              : undefined,
          })
          return ok({ actor: target.name, movementsReattached: moved })
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
        "Manages activities: the user's economic spheres. Two kinds. A personal activity is an analysis dimension and nothing more (a rental, a hobby that brings in three receipts): it partitions the analyses. A business activity is an independent activity the user runs: it has a regime, a fiscal year, the accounts it lives on (accounts, here), invoices, and later the rules that compute what it owes. A movement without an activity is personal. An activity reaches a movement through its external actor first (a client attached to it passes it on, manage_actors), then through the account the money touched, but only when a single activity lives on that account: an account two activities share designates neither, and the movement stays without an activity until someone names it. A transfer between accounts inherits nothing. An activity never changes regime. Its kind and its revenue basis stay correctable only until a rule or an invoice exists under it; from then on, a regime that ends (a flat-rate scheme left for real costs, a business closed in one country and another opened elsewhere) is this activity closed on its last day (action close) and a new activity created with the new settings, so that each year's statement reads the rules it was computed with. Never rewrite history under a new regime. Settings of a business activity, all of them the regime's facts to ask the user about, never to assume: revenueBasis, which date brings a receipt into the revenue and into the bases of the rules, cash (the day the money arrived) or invoiced (the day the invoice was issued); fiscalYearStartMonth and fiscalYearStartDay, the day the fiscal year opens (1 January for most regimes, 6 April in the UK), every \"year\" a rule speaks of being that year; vatRegistered and defaultVatRate (percent), whether the activity charges VAT and the rate proposed on a new invoice, a client's own default possibly differing; deductibleExpenses, all (every expense of the activity reduces its profit, as under a real-costs regime) or none (a flat-rate regime deducts nothing), with set_exceptions naming the categories that go against that policy (left out when all, deductible anyway when none); regimeLabel, free words the screen shows for the regime, written as the user names it, never a switch the code reads; currency, EUR by default; accounts, what the activity lives on. An account is declared from here and never from the account, because an account exists before the activities that use it, and several may run on the same one: a user starting a second activity on the bank account they already have declares that account on both, rather than opening a second one. What sharing changes is worth telling the user: the treasury of each activity is the whole balance of those accounts, nothing is apportioned, and what each may pay itself takes off what every activity on those accounts owes, so the same money is never promised twice. The fastest way to create a business activity is not to fill those settings in one by one: browse_regimes walks a questionnaire to a regime model shipped with the app, and create with regime (the model id) and answers (what the user answered) writes the activity AND its rules, its thresholds and its stated figures in one go. The model then decides kind, revenueBasis, vatRegistered, defaultVatRate, deductibleExpenses, the fiscal year, the currency, regimeLabel and jurisdiction, so do not pass them alongside it; name and accounts and startedOn stay yours. What is written is a copy the user owns from that moment: correcting the catalog later never touches it, and every rule is theirs to correct or supersede with manage_levies. Report back the statuses the answer carries, since a rule marked unconfirmed or extended_by_default is one the user must check. jurisdiction, on its own, is where the activity is run, in words, shown and never read by a calculation. Actions: list, create, update (rename or correct settings), close (closedOn defaults to today; a movement dated later is refused under it), reopen (undo a close), set_accounts (the full list of accounts by name, an empty list detaching them all), set_exceptions (the full list of exception categories by name, an empty list clearing them). Create very few: an activity partitions the finances, it is not a tag system.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'close', 'reopen', 'set_accounts', 'set_exceptions']),
        name: z.string().optional().describe('create: the name; other actions: the activity, by name'),
        newName: z.string().optional().describe('update: the corrected name'),
        kind: z
          .enum(['business', 'personal'])
          .optional()
          .describe(
            'create/update: business (a regime, accounts, invoices) or personal (default: an analysis dimension)',
          ),
        startedOn: isoDate.optional().describe('create/update: the day the activity started'),
        closedOn: isoDate.optional().describe('close: the last day of the activity, defaults to today'),
        fiscalYearStartMonth: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe('create/update: month the fiscal year opens (default 1)'),
        fiscalYearStartDay: z
          .number()
          .int()
          .min(1)
          .max(31)
          .optional()
          .describe('create/update: day the fiscal year opens (default 1)'),
        revenueBasis: z
          .enum(['cash', 'invoiced'])
          .optional()
          .describe(
            'create/update: cash (default), the payment day counts; invoiced, the invoice day counts',
          ),
        vatRegistered: z.boolean().optional().describe('create/update: whether the activity charges VAT'),
        defaultVatRate: rate.describe(
          'create/update: percent proposed on a new invoice; requires vatRegistered; null to clear',
        ),
        deductibleExpenses: z
          .enum(['all', 'none'])
          .optional()
          .describe('create/update: all (real costs reduce the profit) or none (default, flat-rate regime)'),
        regimeLabel: z
          .string()
          .optional()
          .describe('create/update: the regime as the user names it, free text, or "none" to clear it'),
        jurisdiction: z
          .string()
          .optional()
          .describe(
            'create/update: where the activity is run, in words, or "none" to clear it. Shown, never read by a calculation. Set by the regime model when one is applied',
          ),
        regime: z
          .string()
          .optional()
          .describe(
            'create: the id of a regime model from browse_regimes. It writes the activity and its rules together, or neither',
          ),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe('create, with regime: the answers the user gave to the questionnaire of browse_regimes'),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe("create/update: ISO 4217 code of the activity's currency (default EUR)"),
        accounts: z
          .array(z.string())
          .optional()
          .describe(
            'create/update/set_accounts: the full list of accounts the activity lives on, by name; it replaces the current one, and [] detaches them all. An account may serve several activities: name it on each',
          ),
        categories: z
          .array(z.string())
          .optional()
          .describe(
            'set_exceptions: the categories that go against deductibleExpenses, by name; [] clears them',
          ),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const [activities, exceptions, categories, links, accounts] = await Promise.all([
            listActivities(userId),
            listCategoryExceptions(userId),
            listCategories(userId),
            listActivityAccounts(userId),
            listAccounts(userId),
          ])
          const categoryName = new Map(categories.map((c) => [c.id, c.name]))
          const accountName = new Map(accounts.map((acc) => [acc.id, acc.name]))
          return ok(
            activities.map((act) =>
              describeActivity(
                act,
                exceptions
                  .filter((e) => e.activityId === act.id)
                  .map((e) => categoryName.get(e.categoryId)!)
                  .sort(),
                links
                  .filter((l) => l.activityId === act.id)
                  .map((l) => accountName.get(l.accountId)!)
                  .sort(),
              ),
            ),
          )
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        const settings = {
          kind: a.kind,
          startedOn: a.startedOn,
          fiscalYearStartMonth: a.fiscalYearStartMonth,
          fiscalYearStartDay: a.fiscalYearStartDay,
          revenueBasis: a.revenueBasis,
          vatRegistered: a.vatRegistered,
          defaultVatRate: a.defaultVatRate,
          deductibleExpenses: a.deductibleExpenses,
          regimeLabel: clearable(a.regimeLabel),
          jurisdiction: clearable(a.jurisdiction),
          currency: a.currency?.toUpperCase(),
        }
        // The accounts are addressed by name here and by id below, and an
        // unknown one fails the whole call rather than half of it.
        const accountIds = a.accounts
          ? await Promise.all(a.accounts.map(async (n) => (await requireAccountByName(userId, n)).id))
          : undefined
        if (a.action === 'create') {
          if (a.regime) return await createFromRegime(a.regime, a.name, a, accountIds)
          if (a.answers)
            return fail('answers only goes with regime: pass the model id from browse_regimes, or drop them.')
          const activity = await createActivity(userId, { name: a.name, ...settings, accountIds })
          return ok({ activityId: activity.id, ...describeActivity(activity, [], a.accounts ?? []) })
        }
        const target = await requireActivityByName(userId, a.name)
        if (a.action === 'update') {
          const updated = await editActivity(userId, target.id, { name: a.newName, ...settings, accountIds })
          // The exceptions and the accounts it already carries come back with
          // it: an answer showing none would read as a correction having
          // dropped them.
          return ok({
            activityId: updated.id,
            ...describeActivity(updated, await exceptionNames(target.id), await accountNames(target.id)),
          })
        }
        if (a.action === 'close') {
          const closed = await closeActivity(userId, target.id, a.closedOn)
          return ok({ activityId: closed.id, name: closed.name, closedOn: closed.closedOn })
        }
        if (a.action === 'reopen') {
          const reopened = await reopenActivity(userId, target.id)
          return ok({ activityId: reopened.id, name: reopened.name, closedOn: null })
        }
        if (a.action === 'set_accounts') {
          if (!accountIds)
            return fail('set_accounts requires accounts: the full list, [] to detach them all.')
          await setActivityAccounts(userId, target.id, accountIds)
          return ok({ activityId: target.id, name: target.name, accounts: a.accounts })
        }
        if (!a.categories) return fail('set_exceptions requires categories: the full list, [] to clear it.')
        const ids = await Promise.all(
          a.categories.map(async (c) => (await requireCategoryByName(userId, c)).id),
        )
        await setActivityCategoryExceptions(userId, target.id, ids)
        return ok({ activityId: target.id, name: target.name, categoryExceptions: a.categories })
      }),
  )
}

/**
 * What an activity change left where it was, and the call that takes it
 * along. The former activity is named here because only this moment knows it.
 */
async function leftBehindNote(
  userId: string,
  actor: string,
  count: number,
  previousActivityId: string | null,
): Promise<string> {
  const previous = previousActivityId
    ? (await listActivities(userId)).find((act) => act.id === previousActivityId)?.name
    : undefined
  const carried = previous ? `still carry "${previous}"` : 'carry no activity'
  const args = previous ? `actor "${actor}" and previousActivity "${previous}"` : `actor "${actor}"`
  return `${count} past movement(s) of "${actor}" ${carried}: this update did not reclassify them. If they belong to the new activity, call reattach_history with ${args} (from narrows it to a date); movements set to another activity on purpose are left alone.`
}
