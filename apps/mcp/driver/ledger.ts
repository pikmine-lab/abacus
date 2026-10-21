import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

type MovementRef = Parameters<Steps['deleteMovement']>[0]

/** A movement as the history lists it, with the claims of an advance. */
export interface ListedMovement {
  id: string
  counterparty?: string
  claims?: { claimId: string; debtor: string }[]
}

/** The movement a case points at, found in the history of its day. */
export async function movementOf(
  { call }: McpContext,
  { counterparty, on }: MovementRef,
): Promise<ListedMovement> {
  const { movements } = await call<{ movements: ListedMovement[] }>('list_movements', { from: on, to: on })
  const found = movements.find((m) => m.counterparty === counterparty)
  if (!found) throw new Error(`no movement with "${counterparty}" on ${on}`)
  return found
}

/** The first and last day of a month, "YYYY-MM". */
function monthBounds(month: string): { from: string; to: string } {
  const [year, monthOfYear] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function ledgerSteps(ctx: McpContext): Partial<Steps> {
  const { call, batch } = ctx
  // The person names each counterparty on purpose: it is created if new.
  const declare = (movement: Record<string, unknown>) =>
    batch('declare_movements', { movements: [movement], createUnknownActors: true })

  return {
    async declareExpense({ account, amount, payee, on }) {
      await declare({ type: 'expense', date: on, amount: Number(amount.amount), account, actor: payee })
    },
    async declareIncome({ account, amount, payer, on }) {
      await declare({ type: 'income', date: on, amount: Number(amount.amount), account, actor: payer })
    },
    async declareTransfer({ from, to, amount, on }) {
      await declare({
        type: 'transfer',
        date: on,
        amount: Number(amount.amount),
        account: from,
        toAccount: to,
      })
    },
    async declareSharedExpense({ account, amount, payee, on, shares }) {
      await declare({
        type: 'expense',
        date: on,
        amount: Number(amount.amount),
        account,
        actor: payee,
        expectedRefunds: shares.map((s) => ({ from: s.debtor, amount: Number(s.amount.amount) })),
      })
    },
    async declareRefund({ account, amount, debtor, on, refunds }) {
      await declare({
        type: 'income',
        date: on,
        amount: Number(amount.amount),
        account,
        actor: debtor,
        refundsMovementId: (await movementOf(ctx, refunds)).id,
      })
    },
    async correctMovementAmount({ movement, amount }) {
      await call('fix_movement', {
        movement: (await movementOf(ctx, movement)).id,
        action: 'correct',
        amount: Number(amount.amount),
      })
    },
    async deleteMovement(movement) {
      await call('fix_movement', { movement: (await movementOf(ctx, movement)).id, action: 'delete' })
    },
    async unlinkRefund(refund) {
      await call('fix_movement', {
        movement: (await movementOf(ctx, refund)).id,
        action: 'correct',
        refundsMovementId: 'none',
      })
    },
    async readNetSpent({ payee, month }) {
      const { rows } = await call<{ rows: { net: number }[] }>('analyze_flows', {
        ...monthBounds(month),
        groupBy: 'actor',
        actor: payee,
      })
      return eur((rows[0]?.net ?? 0).toFixed(2))
    },
  }
}
