import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

const money = (value: number) => eur(value.toFixed(2))

type Judgment = Parameters<Steps['judgeSubscription']>[0]['judgment']

interface ListedCommitment {
  type: 'subscription' | 'financing' | 'investment_plan'
  label: string
  account: string
  amount?: number
  installment?: number
  judgment?: Judgment | 'not judged'
  remainingDue?: number
  reserve?: { remaining: number }
  cancelledOn?: string
  settledOn?: string
  nextDueOn?: string
}

export function commitmentsSteps({ call, batch }: McpContext): Partial<Steps> {
  /** Confirms or skips one occurrence; the tool answers line by line, a failed line with ok: false. */
  async function occurrence(item: Record<string, unknown>) {
    const { results } = await call<{ results: { ok?: boolean; error?: string }[] }>('confirm_due_movements', {
      items: [item],
    })
    const failed = results.find((r) => r.ok === false)
    if (failed) throw new Error(failed.error ?? 'refused')
  }

  return {
    async createSubscription({ label, payee, account, amount, firstDueOn }) {
      await call('manage_subscription', {
        action: 'create',
        label,
        actor: payee,
        account,
        amount: Number(amount.amount),
        firstDueOn,
      })
    },
    async createRecurringIncome({ label, payer, account, amount, firstDueOn }) {
      await call('manage_subscription', {
        action: 'create',
        label,
        actor: payer,
        account,
        amount: Number(amount.amount),
        firstDueOn,
        direction: 'incoming',
      })
    },
    async createInvestmentPlan({ label, from, to, asset, amount, firstDueOn }) {
      await call('manage_investment_plan', {
        action: 'create',
        label,
        account: from,
        targetAccount: to,
        asset,
        amount: Number(amount.amount),
        firstDueOn,
      })
    },
    async createFinancing({ label, creditor, account, total, instalments, firstDueOn }) {
      await call('declare_financing', {
        label,
        actor: creditor,
        account,
        totalAmount: Number(total.amount),
        installmentsTotal: instalments,
        firstDueOn,
      })
    },
    async reviseSchedule({ financing, plan }) {
      const { installments } = await call<{ installments: { id: string }[] }>('manage_financing_schedule', {
        action: 'show',
        commitment: financing,
      })
      await call('manage_financing_schedule', {
        action: 'revise',
        commitment: financing,
        installments: plan.map((line, index) => ({
          id: installments[index]?.id,
          dueOn: line.dueOn,
          amount: Number(line.amount.amount),
        })),
      })
    },
    async readSchedule(financing) {
      const { installments } = await call<{ installments: { dueOn: string; amount: number }[] }>(
        'manage_financing_schedule',
        { action: 'show', commitment: financing },
      )
      return installments.map((i) => ({ dueOn: i.dueOn, amount: money(i.amount) }))
    },
    async confirmOccurrence(commitment) {
      await occurrence({ commitment, action: 'confirm' })
    },
    async confirmPlacement({ plan, quantity }) {
      await occurrence({ commitment: plan, action: 'confirm', quantity: Number(quantity) })
    },
    async skipOccurrence(commitment) {
      await occurrence({ commitment, action: 'skip' })
    },
    async judgeSubscription({ subscription, judgment }) {
      await call('manage_subscription', { action: 'set_judgment', commitment: subscription, judgment })
    },
    async renameCommitment({ commitment, label }) {
      await call('update_commitment', { commitment, label })
    },
    async changeCommitmentAccount({ commitment, account }) {
      await call('change_commitment_account', { commitment, account })
    },
    async changeCommitmentAmount({ commitment, amount }) {
      const { type } = await listed(commitment)
      if (type === 'investment_plan')
        await call('manage_investment_plan', {
          action: 'change_amount',
          commitment,
          amount: Number(amount.amount),
        })
      else
        await call('manage_subscription', {
          action: 'change_price',
          commitment,
          amount: Number(amount.amount),
        })
    },
    async endCommitment(commitment) {
      const { type } = await listed(commitment)
      await call(type === 'investment_plan' ? 'manage_investment_plan' : 'manage_subscription', {
        action: 'cancel',
        commitment,
      })
    },
    async receiveForCommitment({ commitment, account, payer, amount, on }) {
      await batch('declare_movements', {
        movements: [
          {
            type: 'income',
            date: on,
            amount: Number(amount.amount),
            account,
            actor: payer,
            forCommitment: commitment,
          },
        ],
        createUnknownActors: true,
      })
    },
    async readRunningCommitments() {
      const { commitments } = await call<{ commitments: ListedCommitment[] }>('list_commitments', {})
      return commitments
        .filter((c) => !c.cancelledOn && !c.settledOn)
        .map((c) => c.label)
        .sort()
    },
    async readCommitment(label) {
      const c = await listed(label)
      const ended = c.cancelledOn !== undefined || c.settledOn !== undefined
      return {
        account: c.account,
        amount: money(c.type === 'financing' ? c.installment! : c.amount!),
        ...(ended || !c.nextDueOn ? {} : { nextDueOn: c.nextDueOn }),
        ...(c.judgment && c.judgment !== 'not judged' ? { judgment: c.judgment } : {}),
        ...(c.remainingDue !== undefined ? { remainingDue: money(c.remainingDue) } : {}),
        ...(c.reserve ? { reserveLeft: money(c.reserve.remaining) } : {}),
      }
    },
  }

  async function listed(label: string): Promise<ListedCommitment> {
    const { commitments } = await call<{ commitments: ListedCommitment[] }>('list_commitments', {
      includeCancelled: true,
    })
    const found = commitments.find((c) => c.label === label)
    if (!found) throw new Error(`no commitment named "${label}"`)
    return found
  }
}
