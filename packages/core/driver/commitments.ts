import { eur, type Steps } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createInvestmentPlan,
  createSubscription,
  editCommitment,
  financingSchedule,
  listCommitmentsWithProgress,
  moveAccount,
  reviseSchedule,
  setJudgment,
  skipNextOccurrence,
} from '../src/services/commitments.ts'
import { listAssets } from '../src/services/investments.ts'
import { declareMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

const money = (value: string | number) => eur(Number(value).toFixed(2))

export function commitmentsSteps({ user, accountId, actorId }: PreparationContext): Partial<Steps> {
  async function commitment(label: string) {
    const found = (await listCommitmentsWithProgress(user.id, false)).find((c) => c.label === label)
    if (!found) throw new Error(`no commitment named "${label}"`)
    return found
  }
  const idOf = async (label: string) => (await commitment(label)).id

  return {
    async createSubscription({ label, payee, account, amount, firstDueOn }) {
      await createSubscription(user.id, {
        label,
        actorId: await actorId(payee),
        accountId: await accountId(account),
        amount: amountOf(amount),
        periodUnit: 'month',
        firstDueOn,
      })
    },
    async createRecurringIncome({ label, payer, account, amount, firstDueOn }) {
      await createSubscription(user.id, {
        label,
        actorId: await actorId(payer),
        accountId: await accountId(account),
        direction: 'incoming',
        amount: amountOf(amount),
        periodUnit: 'month',
        firstDueOn,
      })
    },
    async createInvestmentPlan({ label, from, to, asset, amount, firstDueOn }) {
      const bought = (await listAssets(user.id)).find((a) => a.name === asset)
      if (!bought) throw new Error(`no asset named "${asset}"`)
      await createInvestmentPlan(user.id, {
        label,
        accountId: await accountId(from),
        targetAccountId: await accountId(to),
        assetId: bought.id,
        amount: amountOf(amount),
        periodUnit: 'month',
        firstDueOn,
      })
    },
    async createFinancing({ label, creditor, account, total, instalments, firstDueOn }) {
      await createFinancing(user.id, {
        label,
        actorId: await actorId(creditor),
        accountId: await accountId(account),
        totalAmount: amountOf(total),
        installmentsTotal: instalments,
        periodUnit: 'month',
        firstDueOn,
      })
    },
    async reviseSchedule({ financing, plan }) {
      const id = await idOf(financing)
      const current = await financingSchedule(user.id, id)
      await reviseSchedule(
        user.id,
        id,
        plan.map((line, index) => ({
          id: current[index]?.id,
          dueOn: line.dueOn,
          amount: amountOf(line.amount),
        })),
      )
    },
    async readSchedule(financing) {
      return (await financingSchedule(user.id, await idOf(financing))).map((i) => ({
        dueOn: i.dueOn,
        amount: money(i.amount),
      }))
    },
    async confirmOccurrence(label) {
      await confirmNextOccurrence(user.id, await idOf(label), {})
    },
    async confirmPlacement({ plan, quantity }) {
      await confirmNextOccurrence(user.id, await idOf(plan), { quantity: Number(quantity) })
    },
    async skipOccurrence(label) {
      await skipNextOccurrence(user.id, await idOf(label))
    },
    async judgeSubscription({ subscription, judgment }) {
      await setJudgment(user.id, await idOf(subscription), judgment)
    },
    async renameCommitment({ commitment: label, label: renamed }) {
      await editCommitment(user.id, await idOf(label), { label: renamed })
    },
    async changeCommitmentAccount({ commitment: label, account }) {
      await moveAccount(user.id, await idOf(label), await accountId(account))
    },
    async changeCommitmentAmount({ commitment: label, amount }) {
      await changeAmount(user.id, await idOf(label), amountOf(amount))
    },
    async endCommitment(label) {
      await cancelCommitment(user.id, await idOf(label))
    },
    async receiveForCommitment({ commitment: label, account, payer, amount, on }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceActorId: await actorId(payer),
        targetAccountId: await accountId(account),
        reservesCommitmentId: await idOf(label),
      })
    },
    async readRunningCommitments() {
      return (await listCommitmentsWithProgress(user.id, true))
        .filter((c) => !c.settledOn)
        .map((c) => c.label)
        .sort()
    },
    async readCommitment(label) {
      const c = await commitment(label)
      const names = new Map((await listAccounts(user.id)).map((a) => [a.id, a.name]))
      const ended = c.cancelledOn !== null || (c.settledOn ?? null) !== null
      return {
        account: names.get(c.accountId) ?? '',
        amount: money(c.amount),
        ...(ended ? {} : { nextDueOn: c.nextDueOn }),
        ...(c.judgment ? { judgment: c.judgment } : {}),
        ...(c.progress ? { remainingDue: money(c.progress.remainingDue) } : {}),
        ...(c.reserve ? { reserveLeft: money(c.reserve.remaining) } : {}),
      }
    },
  }
}
