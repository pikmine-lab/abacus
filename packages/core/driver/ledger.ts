import { eur, type Steps } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
import { listActors } from '../src/services/actors.ts'
import { listCategories } from '../src/services/catalog.ts'
import { correctMovement, declareMovement, deleteMovement, listMovements } from '../src/services/movements.ts'
import { readingPreference } from '../src/services/preferences.ts'
import { spendingBreakdown } from '../src/services/reports.ts'
import { amountOf, type PreparationContext } from './context.ts'

type MovementRef = Parameters<Steps['deleteMovement']>[0]

/** The first and last day of a month, "YYYY-MM". */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthOfYear] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** The movement a case points at: the one of that day whose counterparty bears that name. */
export async function movementOf(userId: string, { counterparty, on }: MovementRef) {
  const [movements, actors, accounts] = await Promise.all([
    listMovements(userId, { from: on, to: on }),
    listActors(userId),
    listAccounts(userId),
  ])
  const name = new Map([...actors, ...accounts].map((e) => [e.id, e.name]))
  const found = movements.find((m) =>
    [m.targetActorId, m.sourceActorId, m.kind === 'transfer' ? m.targetAccountId : null].some(
      (id) => id && name.get(id) === counterparty,
    ),
  )
  if (!found) throw new Error(`no movement with "${counterparty}" on ${on}`)
  return found
}

export function ledgerSteps({ user, accountId, actorId }: PreparationContext): Partial<Steps> {
  return {
    async declareExpense({ account, amount, payee, on }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: await accountId(account),
        targetActorId: await actorId(payee),
      })
    },
    async declareIncome({ account, amount, payer, on }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceActorId: await actorId(payer),
        targetAccountId: await accountId(account),
      })
    },
    async declareTransfer({ from, to, amount, on }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: await accountId(from),
        targetAccountId: await accountId(to),
      })
    },
    async declareSharedExpense({ account, amount, payee, on, shares }) {
      const refundShares = []
      for (const share of shares)
        refundShares.push({ debtorActorId: await actorId(share.debtor), amount: amountOf(share.amount) })
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: await accountId(account),
        targetActorId: await actorId(payee),
        refundShares,
      })
    },
    async declareRefund({ account, amount, debtor, on, refunds }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceActorId: await actorId(debtor),
        targetAccountId: await accountId(account),
        refundsMovementId: (await movementOf(user.id, refunds)).id,
      })
    },
    async correctMovementAmount({ movement, amount }) {
      await correctMovement(user.id, (await movementOf(user.id, movement)).id, { amount: amountOf(amount) })
    },
    async deleteMovement(movement) {
      await deleteMovement(user.id, (await movementOf(user.id, movement)).id)
    },
    async unlinkRefund(refund) {
      await correctMovement(user.id, (await movementOf(user.id, refund)).id, {
        refundsMovementId: null,
        refundsShareId: null,
      })
    },
    async readNetSpent({ payee, month }) {
      const actor = (await listActors(user.id)).find((a) => a.name === payee)
      if (!actor) return eur('0.00')
      const { from, to } = monthBounds(month)
      const rows = await spendingBreakdown(
        user.id,
        from,
        to,
        'actor',
        'expense',
        await readingPreference(user.id),
        { actorId: actor.id },
      )
      return eur(Number(rows[0]?.net ?? 0).toFixed(2))
    },
    async fileMovement({ movement, category }) {
      const found = (await listCategories(user.id)).find((c) => c.name === category)
      if (!found) throw new Error(`no category named "${category}"`)
      await correctMovement(user.id, (await movementOf(user.id, movement)).id, { categoryId: found.id })
    },
  }
}
