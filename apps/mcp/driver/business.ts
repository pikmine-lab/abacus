import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

const money = (value: number) => eur(value.toFixed(2))

interface ListedActivity {
  name: string
  kind: 'business' | 'personal'
  closedOn?: string
  regimeLabel?: string
  accounts?: string[]
  categoryExceptions?: string[]
}

interface ListedInvoice {
  invoiceId: string
  client: string
  reference?: string
  issuedOn: string
  state: 'pending' | 'overdue' | 'paid' | 'cancelled'
  base: number
  vat: number
  receivable: number
  remindedOn?: string
  cancelledOn?: string
  /** Absent when the invoice is in euros. */
  currency?: string
}

interface ListedLevy {
  name: string
  validFrom: string
  validTo?: string
  amount: { rate?: number }
  modifiers: { label: string }[]
}

interface Question {
  id: string
  options: { value: string; label: string }[]
}

export function businessSteps({ call, batch }: McpContext): Partial<Steps> {
  async function activityNamed(name: string) {
    const activities = await call<ListedActivity[]>('manage_activities', { action: 'list' })
    const found = activities.find((a) => a.name === name)
    if (!found) throw new Error(`no activity named "${name}"`)
    return found
  }
  async function invoices() {
    return (await call<{ invoices: ListedInvoice[] }>('list_invoices', {})).invoices
  }
  async function invoiceNamed(reference: string) {
    const found = (await invoices()).find((i) => i.reference === reference)
    if (!found) throw new Error(`no invoice "${reference}"`)
    return found
  }
  const dueOf = (due: { activity: string; levy: string; periodStart: string }) => ({
    activity: due.activity,
    levy: due.levy,
    periodStart: due.periodStart,
  })
  /** Walks the questionnaire, answering each question by its option's label. */
  async function walk({ jurisdiction, answers }: { jurisdiction: string; answers: string[] }) {
    const places = await call<{ id: string; name: string }[]>('browse_regimes', { action: 'jurisdictions' })
    const place = places.find((p) => p.name === jurisdiction)
    if (!place) throw new Error(`no jurisdiction "${jurisdiction}"`)
    const given: Record<string, string> = {}
    for (const label of answers) {
      const { question } = await call<{ question?: Question }>('browse_regimes', {
        action: 'questions',
        jurisdiction: place.id,
        answers: given,
      })
      const option = question?.options.find((o) => o.label === label)
      if (!question || !option) throw new Error(`no option "${label}" to answer`)
      given[question.id] = option.value
    }
    const step = await call<{ done: boolean; models: { id: string }[] }>('browse_regimes', {
      action: 'questions',
      jurisdiction: place.id,
      answers: given,
    })
    if (!step.done || step.models.length !== 1) throw new Error('the walk does not end on one model')
    return { answers: given, model: step.models[0]!.id }
  }

  return {
    async createActivity({ name, kind = 'business', startedOn, accounts, regimeLabel }) {
      await call('manage_activities', { action: 'create', name, kind, startedOn, accounts, regimeLabel })
    },
    async editActivity(activity, { name, regimeLabel }) {
      await call('manage_activities', { action: 'update', name: activity, newName: name, regimeLabel })
    },
    async setActivityAccounts(activity, accounts) {
      await call('manage_activities', { action: 'set_accounts', name: activity, accounts })
    },
    async closeActivity(activity, on) {
      await call('manage_activities', { action: 'close', name: activity, closedOn: on })
    },
    async reopenActivity(activity) {
      await call('manage_activities', { action: 'reopen', name: activity })
    },
    async setActivityExceptions(activity, categories) {
      await call('manage_activities', { action: 'set_exceptions', name: activity, categories })
    },
    async readActivity(name) {
      const activity = await activityNamed(name)
      return {
        name: activity.name,
        kind: activity.kind,
        regimeLabel: activity.regimeLabel ?? null,
        closedOn: activity.closedOn ?? null,
        accounts: activity.accounts ?? [],
        exceptions: activity.categoryExceptions ?? [],
      }
    },

    async declareInvoice({ activity, client, reference, issuedOn, dueOn, base, vatRate }) {
      // The person names the client on purpose: it is created if new.
      await batch('declare_invoices', {
        invoices: [
          {
            activity,
            client,
            reference,
            issuedOn,
            dueOn,
            baseAmount: Number(base.amount),
            vatRate: vatRate === undefined ? undefined : Number(vatRate),
            ...(base.currency !== 'EUR' ? { currency: base.currency } : {}),
          },
        ],
        createUnknownActors: true,
      })
    },
    async correctInvoice(reference, { base, currency }) {
      await call('fix_invoice', {
        invoice: reference,
        action: 'correct',
        baseAmount: base ? Number(base.amount) : undefined,
        currency,
      })
    },
    async remindInvoice(reference, on) {
      await call('fix_invoice', { invoice: reference, action: 'remind', on })
    },
    async cancelInvoice(reference, on) {
      await call('fix_invoice', { invoice: reference, action: 'cancel', on })
    },
    async settleInvoice({ reference, account, on }) {
      await call('settle_invoice', { invoice: reference, account, date: on })
    },
    async readInvoice(reference) {
      const invoice = await invoiceNamed(reference)
      const inCurrency = (value: number) => ({ ...money(value), currency: invoice.currency ?? 'EUR' })
      return {
        client: invoice.client,
        issuedOn: invoice.issuedOn,
        base: inCurrency(invoice.base),
        vat: inCurrency(invoice.vat),
        receivable: inCurrency(invoice.receivable),
        state: invoice.state,
        ...(invoice.cancelledOn ? { cancelledOn: invoice.cancelledOn } : {}),
      }
    },
    async readInvoiceReminder(reference) {
      return (await invoiceNamed(reference)).remindedOn ?? null
    },

    async createLevy({ activity, name, kind, validFrom, rate, period, source, settledIn }) {
      await call('manage_levies', {
        action: 'create',
        activity,
        name,
        kind,
        validFrom,
        sourceUrl: source.url,
        verifiedOn: source.readOn,
        baseMeasure: 'revenue',
        basePeriodRef: 'current',
        amountForm: 'rate',
        rate: Number(rate),
        period,
        due: { type: 'end_of_next_month' },
        settlementCategory: settledIn,
      })
    },
    async correctLevyRate(activity, levy, rate) {
      await call('manage_levies', { action: 'update', activity, levy, rate: Number(rate) })
    },
    async supersedeLevy(activity, levy, { from, rate, source }) {
      await call('manage_levies', {
        action: 'supersede',
        activity,
        levy,
        validFrom: from,
        rate: Number(rate),
        sourceUrl: source.url,
        verifiedOn: source.readOn,
      })
    },
    async closeLevy(activity, levy, on) {
      await call('manage_levies', { action: 'close', activity, levy, validTo: on })
    },
    async deleteLevy(activity, levy) {
      await call('manage_levies', { action: 'delete', activity, levy })
    },
    async addLevyModifier(activity, levy, { label, rateFactor, months }) {
      await call('manage_levies', {
        action: 'add_modifier',
        activity,
        levy,
        modifierLabel: label,
        effect: 'rate_factor',
        value: Number(rateFactor),
        durationMonths: months,
      })
    },
    async removeLevyModifier(activity, levy, label) {
      await call('manage_levies', { action: 'remove_modifier', activity, levy, modifierLabel: label })
    },
    async readLevies(activity) {
      const { levies } = await call<{ levies: ListedLevy[] }>('manage_levies', { action: 'list', activity })
      return levies.map((levy) => ({
        name: levy.name,
        validFrom: levy.validFrom,
        validTo: levy.validTo ?? null,
        rate: levy.amount.rate === undefined ? null : String(levy.amount.rate),
        modifiers: levy.modifiers.map((m) => m.label),
      }))
    },

    async readStatement(activity, year) {
      const statement = await call<{ year: { revenue: number; net: number }; reserve: number }>(
        'get_activity_statement',
        { activity, year },
      )
      return {
        revenue: money(statement.year.revenue),
        net: money(statement.year.net),
        reserve: money(statement.reserve),
      }
    },
    async readDueDate(due) {
      const { schedule } = await call<{
        schedule: {
          levy: string
          what: string
          period: { from: string }
          amount: number
          status: 'paid' | 'nil_return' | 'nothing_due' | 'upcoming' | 'overdue'
        }[]
      }>('get_activity_statement', { activity: due.activity, year: Number(due.periodStart.slice(0, 4)) })
      const entry = schedule.find(
        (e) => e.levy === due.levy && e.what === 'period' && e.period.from === due.periodStart,
      )
      if (!entry) throw new Error(`no due date of "${due.levy}" from ${due.periodStart}`)
      return { amount: money(entry.amount), status: entry.status }
    },
    async declareNilReturn(due) {
      await batch('confirm_nil_returns', { activity: due.activity, returns: [dueOf(due)] })
    },
    async withdrawNilReturn(due) {
      await batch('confirm_nil_returns', { activity: due.activity, returns: [dueOf(due)], withdraw: true })
    },
    async payLevy({ amount, on, account, payee, ...due }) {
      await call('confirm_levy_payment', {
        ...dueOf(due),
        amount: Number(amount.amount),
        date: on,
        account,
        actor: payee,
      })
    },

    async setActivityFigure(activity, { name, validFrom, value }) {
      await call('set_activity_inputs', { action: 'set', activity, name, validFrom, value: Number(value) })
    },
    async removeActivityFigure(activity, { name, validFrom }) {
      await call('set_activity_inputs', { action: 'remove', activity, name, validFrom })
    },
    async readActivityFigures(activity) {
      const { inputs } = await call<{ inputs: { name: string; validFrom: string; value: number }[] }>(
        'set_activity_inputs',
        { action: 'list', activity },
      )
      return inputs.map((i) => ({ name: i.name, validFrom: i.validFrom, value: String(i.value) }))
    },

    async createThreshold({ activity, label, value, consequence }) {
      await call('manage_thresholds', {
        action: 'create',
        activity,
        label,
        measure: 'revenue',
        periodRef: 'ytd',
        comparison: 'lte',
        value: Number(value.amount),
        consequence,
      })
    },
    async editThreshold(activity, label, { value }) {
      await call('manage_thresholds', {
        action: 'update',
        activity,
        threshold: label,
        value: Number(value.amount),
      })
    },
    async removeThreshold(activity, label) {
      await call('manage_thresholds', { action: 'remove', activity, threshold: label })
    },
    async readThresholds(activity) {
      const { thresholds } = await call<{
        thresholds: { label: string; value: number; consequence: string }[]
      }>('manage_thresholds', { action: 'list', activity })
      return thresholds.map((t) => ({ label: t.label, value: money(t.value), consequence: t.consequence }))
    },

    async previewRegime(regime) {
      const { answers, model } = await walk(regime)
      const preview = await call<{ model: { name: string }; rules: { name: string }[] }>('browse_regimes', {
        action: 'preview',
        model,
        answers,
      })
      return { model: preview.model.name, rules: preview.rules.map((r) => r.name) }
    },
    async createActivityFromRegime({ name, startedOn, accounts, ...regime }) {
      const { answers, model } = await walk(regime)
      await call('manage_activities', { action: 'create', name, regime: model, answers, startedOn, accounts })
    },
  }
}
