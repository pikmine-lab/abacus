import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'
import { movementOf } from './ledger.ts'

type ShareRef = Parameters<Steps['removeShare']>[0]

/** A claim as the outstanding advances list it. */
interface Outstanding {
  claimId: string
  debtor: string
  remaining: number
  account: string
  advancedOn: { paidTo?: string; date?: string }
  nextDueOn?: string
  nextDueAmount?: number
}

export function advancesSteps(ctx: McpContext): Partial<Steps> {
  const { call, batch } = ctx

  /** The claim of that person on that expense, as its history carries it. */
  async function claimId({ expense, debtor }: ShareRef): Promise<string> {
    const claim = (await movementOf(ctx, expense)).claims?.find((c) => c.debtor === debtor)
    if (!claim) throw new Error(`${debtor} owes nothing on "${expense.counterparty}" of ${expense.on}`)
    return claim.claimId
  }

  return {
    async refundShare({ amount, on, ...share }) {
      // The way the tools say a refund arrived: an income from the debtor, on
      // the account the claim names, paying that claim.
      const id = await claimId(share)
      const claims = await call<Outstanding[]>('list_outstanding_advances', {})
      const claim = claims.find((c) => c.claimId === id)
      if (!claim) throw new Error(`the claim of ${share.debtor} is not awaited`)
      await batch('declare_movements', {
        movements: [
          {
            type: 'income',
            date: on,
            amount: Number(amount.amount),
            account: claim.account,
            actor: share.debtor,
            claimId: id,
          },
        ],
      })
    },
    async removeShare(share) {
      await call('manage_claims', { claimId: await claimId(share), action: 'remove' })
    },
    async planShare({ count, firstDueOn, ...share }) {
      await call('manage_claims', { claimId: await claimId(share), action: 'plan', count, firstDueOn })
    },
    async dropSharePlan(share) {
      await call('manage_claims', { claimId: await claimId(share), action: 'drop_plan' })
    },
    async writeOffShare(share) {
      await call('close_advance', { claimId: await claimId(share) })
    },
    async readOpenClaims() {
      const claims = await call<Outstanding[]>('list_outstanding_advances', {})
      return claims.map((c) => ({
        debtor: c.debtor,
        expense: { counterparty: c.advancedOn.paidTo ?? '?', on: c.advancedOn.date ?? '?' },
        remaining: eur(c.remaining.toFixed(2)),
        ...(c.nextDueOn && c.nextDueAmount !== undefined
          ? { nextDue: { on: c.nextDueOn, amount: eur(c.nextDueAmount.toFixed(2)) } }
          : {}),
      }))
    },
  }
}
