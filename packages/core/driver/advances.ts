import { eur, type Steps } from '@abacus/use-case-language'
import { listActors } from '../src/services/actors.ts'
import { closeShare, openClaims, removeShare, setShareSchedule } from '../src/services/advances.ts'
import { readMovement, refundShare } from '../src/services/movements.ts'
import type { PreparationContext } from './context.ts'
import { movementOf } from './ledger.ts'

type ShareRef = Parameters<Steps['removeShare']>[0]

export function advancesSteps({ user }: PreparationContext): Partial<Steps> {
  /** The share that person owes on that expense. */
  async function shareId({ expense, debtor }: ShareRef): Promise<string> {
    const movement = await readMovement(user.id, (await movementOf(user.id, expense)).id)
    const actor = (await listActors(user.id)).find((a) => a.name === debtor)
    const share = movement?.shares?.find((s) => s.debtorActorId === actor?.id)
    if (!share) throw new Error(`${debtor} owes nothing on "${expense.counterparty}" of ${expense.on}`)
    return share.id
  }

  return {
    async refundShare({ amount, on, ...share }) {
      await refundShare(user.id, await shareId(share), { amount: Number(amount.amount), on })
    },
    async removeShare(share) {
      await removeShare(user.id, await shareId(share))
    },
    async planShare({ count, firstDueOn, ...share }) {
      await setShareSchedule(user.id, await shareId(share), { count, firstDueOn })
    },
    async dropSharePlan(share) {
      await setShareSchedule(user.id, await shareId(share), null)
    },
    async writeOffShare(share) {
      await closeShare(user.id, await shareId(share))
    },
    async readOpenClaims() {
      const [claims, actors] = await Promise.all([openClaims(user.id), listActors(user.id)])
      const name = new Map(actors.map((a) => [a.id, a.name]))
      return claims.map((c) => ({
        debtor: name.get(c.share.debtorActorId) ?? '?',
        expense: {
          counterparty: name.get(c.movement?.targetActorId ?? '') ?? '?',
          on: c.movement?.purchasedOn ?? c.movement?.happenedOn ?? '?',
        },
        remaining: eur(c.remaining.toFixed(2)),
        ...(c.nextDueOn && c.nextDueAmount !== null
          ? { nextDue: { on: c.nextDueOn, amount: eur(c.nextDueAmount.toFixed(2)) } }
          : {}),
      }))
    },
  }
}
