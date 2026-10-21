import { eur, type Steps } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
import {
  activityStatement,
  confirmLevyPayment,
  confirmNilReturn,
  withdrawNilReturn,
} from '../src/services/activityStatement.ts'
import { listActors } from '../src/services/actors.ts'
import {
  closeActivity,
  createActivity,
  editActivity,
  listActivities,
  listActivityAccounts,
  listCategories,
  listCategoryExceptions,
  reopenActivity,
  setActivityAccounts,
  setActivityCategoryExceptions,
} from '../src/services/catalog.ts'
import {
  cancelInvoice,
  correctInvoice,
  declareInvoice,
  listInvoices,
  remindInvoice,
  settleInvoice,
} from '../src/services/invoices.ts'
import {
  addModifier,
  closeLevy,
  createLevy,
  createThreshold,
  deleteLevy,
  editLevy,
  editThreshold,
  listInputs,
  listLevies,
  listThresholds,
  removeInput,
  removeModifier,
  removeThreshold,
  setInput,
  supersedeLevy,
} from '../src/services/levies.ts'
import { applyRegime, listJurisdictions, previewRegime, questionnaire } from '../src/services/regimes.ts'
import { amountOf, type PreparationContext } from './context.ts'

const money = (value: string | number) => eur(Number(value).toFixed(2))
const byName = (a: string, b: string) => a.localeCompare(b, 'fr')

export function businessSteps({ user, accountId, actorId }: PreparationContext): Partial<Steps> {
  const userId = user.id

  async function activityNamed(name: string) {
    const found = (await listActivities(userId)).find((a) => a.name === name)
    if (!found) throw new Error(`no activity named "${name}"`)
    return found
  }
  async function categoryId(name: string) {
    const found = (await listCategories(userId)).find((c) => c.name === name)
    if (!found) throw new Error(`no category named "${name}"`)
    return found.id
  }
  async function invoiceNamed(reference: string) {
    const found = (await listInvoices(userId)).find((i) => i.reference === reference)
    if (!found) throw new Error(`no invoice "${reference}"`)
    return found
  }
  async function levyNamed(activity: string, name: string) {
    const levies = await listLevies(userId, (await activityNamed(activity)).id)
    const found = levies.filter((l) => l.name === name).at(-1)
    if (!found) throw new Error(`no rule "${name}" on "${activity}"`)
    return found
  }
  /** The due date's rule is the row of that name in force on the period's first day. */
  async function dueOf(due: { activity: string; levy: string; periodStart: string }) {
    const { periodStart } = due
    const levies = await listLevies(userId, (await activityNamed(due.activity)).id)
    const found = levies.find(
      (l) =>
        l.name === due.levy && l.validFrom <= periodStart && (l.validTo === null || l.validTo >= periodStart),
    )
    if (!found) throw new Error(`no rule "${due.levy}" in force on ${periodStart}`)
    return { levyId: found.id, periodStart }
  }
  async function thresholdNamed(activity: string, label: string) {
    const found = (await listThresholds(userId, (await activityNamed(activity)).id)).find(
      (t) => t.label === label,
    )
    if (!found) throw new Error(`no threshold "${label}" on "${activity}"`)
    return found
  }
  /** The catalog's answers, from the option labels a walk gives, question by question. */
  function answersOf(walk: { jurisdiction: string; answers: string[] }) {
    const jurisdiction = listJurisdictions().find((j) => j.name === walk.jurisdiction)
    if (!jurisdiction) throw new Error(`no jurisdiction "${walk.jurisdiction}"`)
    const answers: Record<string, string> = {}
    for (const label of walk.answers) {
      const { question } = questionnaire(jurisdiction.id, answers)
      const option = question?.options.find((o) => o.label === label)
      if (!question || !option) throw new Error(`no option "${label}" to answer`)
      answers[question.id] = option.value
    }
    const step = questionnaire(jurisdiction.id, answers)
    if (!step.done || step.models.length !== 1) throw new Error('the walk does not end on one model')
    return { answers, modelId: step.models[0]!.id }
  }

  return {
    async createActivity({ name, kind = 'business', startedOn, accounts, regimeLabel }) {
      await createActivity(userId, {
        name,
        kind,
        startedOn,
        regimeLabel,
        accountIds: accounts ? await Promise.all(accounts.map(accountId)) : undefined,
      })
    },
    async editActivity(activity, { name, regimeLabel }) {
      await editActivity(userId, (await activityNamed(activity)).id, { name, regimeLabel })
    },
    async setActivityAccounts(activity, accounts) {
      await setActivityAccounts(
        userId,
        (await activityNamed(activity)).id,
        await Promise.all(accounts.map(accountId)),
      )
    },
    async closeActivity(activity, on) {
      await closeActivity(userId, (await activityNamed(activity)).id, on)
    },
    async reopenActivity(activity) {
      await reopenActivity(userId, (await activityNamed(activity)).id)
    },
    async setActivityExceptions(activity, categories) {
      await setActivityCategoryExceptions(
        userId,
        (await activityNamed(activity)).id,
        await Promise.all(categories.map(categoryId)),
      )
    },
    async readActivity(name) {
      const activity = await activityNamed(name)
      const [links, accounts, exceptions, categories] = await Promise.all([
        listActivityAccounts(userId),
        listAccounts(userId),
        listCategoryExceptions(userId),
        listCategories(userId),
      ])
      const accountName = new Map(accounts.map((a) => [a.id, a.name]))
      const categoryName = new Map(categories.map((c) => [c.id, c.name]))
      return {
        name: activity.name,
        kind: activity.kind,
        regimeLabel: activity.regimeLabel,
        closedOn: activity.closedOn,
        accounts: links
          .filter((l) => l.activityId === activity.id)
          .map((l) => accountName.get(l.accountId) as string)
          .sort(byName),
        exceptions: exceptions
          .filter((e) => e.activityId === activity.id)
          .map((e) => categoryName.get(e.categoryId) as string)
          .sort(byName),
      }
    },

    async declareInvoice({ activity, client, reference, issuedOn, dueOn, base, vatRate }) {
      await declareInvoice(userId, {
        activityId: (await activityNamed(activity)).id,
        actorId: await actorId(client),
        reference,
        issuedOn,
        dueOn,
        baseAmount: amountOf(base),
        currency: base.currency,
        vatRate: vatRate === undefined ? undefined : Number(vatRate),
      })
    },
    async correctInvoice(reference, { base, currency }) {
      await correctInvoice(userId, (await invoiceNamed(reference)).id, {
        baseAmount: base ? amountOf(base) : undefined,
        currency,
      })
    },
    async remindInvoice(reference, on) {
      await remindInvoice(userId, (await invoiceNamed(reference)).id, on)
    },
    async cancelInvoice(reference, on) {
      await cancelInvoice(userId, (await invoiceNamed(reference)).id, on)
    },
    async settleInvoice({ reference, account, on }) {
      await settleInvoice(userId, (await invoiceNamed(reference)).id, {
        date: on,
        accountId: await accountId(account),
      })
    },
    async readInvoice(reference) {
      const invoice = await invoiceNamed(reference)
      const client = (await listActors(userId)).find((a) => a.id === invoice.actorId)
      const inCurrency = (value: string) => ({ ...money(value), currency: invoice.currency })
      return {
        client: client?.name ?? '?',
        issuedOn: invoice.issuedOn,
        base: inCurrency(invoice.baseAmount),
        vat: inCurrency(invoice.vatAmount),
        receivable: inCurrency(invoice.receivableAmount),
        state: invoice.state,
        ...(invoice.cancelledOn ? { cancelledOn: invoice.cancelledOn } : {}),
      }
    },
    async readInvoiceReminder(reference) {
      return (await invoiceNamed(reference)).remindedOn
    },

    async createLevy({ activity, name, kind, validFrom, rate, period, source, settledIn }) {
      await createLevy(userId, {
        activityId: (await activityNamed(activity)).id,
        name,
        kind,
        validFrom,
        sourceUrl: source.url,
        verifiedOn: source.readOn,
        baseMeasure: 'revenue',
        amountForm: 'rate',
        rate: Number(rate),
        period,
        due: { type: 'end_of_next_month' },
        settlementCategoryId: settledIn ? await categoryId(settledIn) : undefined,
      })
    },
    async correctLevyRate(activity, levy, rate) {
      await editLevy(userId, (await levyNamed(activity, levy)).id, { rate: Number(rate) })
    },
    async supersedeLevy(activity, levy, { from, rate, source }) {
      await supersedeLevy(userId, (await levyNamed(activity, levy)).id, {
        validFrom: from,
        sourceUrl: source.url,
        verifiedOn: source.readOn,
        rate: Number(rate),
      })
    },
    async closeLevy(activity, levy, on) {
      await closeLevy(userId, (await levyNamed(activity, levy)).id, on)
    },
    async deleteLevy(activity, levy) {
      await deleteLevy(userId, (await levyNamed(activity, levy)).id)
    },
    async addLevyModifier(activity, levy, { label, rateFactor, months }) {
      await addModifier(userId, (await levyNamed(activity, levy)).id, {
        label,
        effect: 'rate_factor',
        value: Number(rateFactor),
        durationMonths: months,
      })
    },
    async removeLevyModifier(activity, levy, label) {
      const modifier = (await levyNamed(activity, levy)).modifiers.find((m) => m.label === label)
      if (!modifier) throw new Error(`no modifier "${label}" on "${levy}"`)
      await removeModifier(userId, modifier.id)
    },
    async readLevies(activity) {
      return (await listLevies(userId, (await activityNamed(activity)).id)).map((levy) => ({
        name: levy.name,
        validFrom: levy.validFrom,
        validTo: levy.validTo,
        rate: levy.rate === null ? null : String(Number(levy.rate)),
        modifiers: levy.modifiers.map((m) => m.label),
      }))
    },

    async readStatement(activity, year) {
      const { totals, reserve } = await activityStatement(userId, (await activityNamed(activity)).id, year)
      return { revenue: money(totals.revenue), net: money(totals.net), reserve: money(reserve) }
    },
    async readDueDate(due) {
      const activity = await activityNamed(due.activity)
      const { levyId, periodStart } = await dueOf(due)
      const year = Number(periodStart.slice(0, 4))
      const entry = (await activityStatement(userId, activity.id, year)).schedule.find(
        (e) => e.levyId === levyId && e.entry === 'period' && e.period.from === periodStart,
      )
      if (!entry) throw new Error(`no due date of "${due.levy}" from ${periodStart}`)
      return { amount: money(entry.amount), status: entry.status }
    },
    async declareNilReturn(due) {
      await confirmNilReturn(userId, await dueOf(due))
    },
    async withdrawNilReturn(due) {
      await withdrawNilReturn(userId, await dueOf(due))
    },
    async payLevy({ amount, on, account, payee, ...due }) {
      await confirmLevyPayment(userId, {
        ...(await dueOf(due)),
        amount: amountOf(amount),
        date: on,
        accountId: await accountId(account),
        actorId: await actorId(payee),
      })
    },

    async setActivityFigure(activity, { name, validFrom, value }) {
      await setInput(userId, (await activityNamed(activity)).id, { name, validFrom, value: Number(value) })
    },
    async removeActivityFigure(activity, { name, validFrom }) {
      const inputs = await listInputs(userId, (await activityNamed(activity)).id)
      const found = inputs.find((i) => i.name === name && i.validFrom === validFrom)
      if (!found) throw new Error(`no figure "${name}" from ${validFrom}`)
      await removeInput(userId, found.id)
    },
    async readActivityFigures(activity) {
      return (await listInputs(userId, (await activityNamed(activity)).id)).map((i) => ({
        name: i.name,
        validFrom: i.validFrom,
        value: String(Number(i.value)),
      }))
    },

    async createThreshold({ activity, label, value, consequence }) {
      await createThreshold(userId, (await activityNamed(activity)).id, {
        label,
        measure: 'revenue',
        periodRef: 'ytd',
        comparison: 'lte',
        value: amountOf(value),
        consequence,
      })
    },
    async editThreshold(activity, label, { value }) {
      await editThreshold(userId, (await thresholdNamed(activity, label)).id, { value: amountOf(value) })
    },
    async removeThreshold(activity, label) {
      await removeThreshold(userId, (await thresholdNamed(activity, label)).id)
    },
    async readThresholds(activity) {
      return (await listThresholds(userId, (await activityNamed(activity)).id)).map((t) => ({
        label: t.label,
        value: money(t.value),
        consequence: t.consequence,
      }))
    },

    async previewRegime(walk) {
      const { answers, modelId } = answersOf(walk)
      const preview = previewRegime(modelId, answers)
      return { model: preview.model.name, rules: preview.levies.map(({ levy }) => levy.name) }
    },
    async createActivityFromRegime({ name, startedOn, accounts, ...walk }) {
      const { answers, modelId } = answersOf(walk)
      await applyRegime(userId, {
        name,
        modelId,
        answers,
        startedOn,
        accountIds: await Promise.all(accounts.map(accountId)),
      })
    },
  }
}
