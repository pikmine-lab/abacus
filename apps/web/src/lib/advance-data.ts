import type { Movement } from '@abacus/core/domain'
import { addPeriod, today } from '@abacus/core/domain/period'
import { describeShares, type OpenClaim, openClaims } from '@abacus/core/services/advances'
import { listCommitments } from '@abacus/core/services/commitments'
import { listMovements } from '@abacus/core/services/movements'
import { getTranslations } from 'next-intl/server'
import type { LinkChoice } from '@/components/advance-links'
import { getFormat } from '@/lib/format-server'

/** How far back an income or an expense is offered to be linked: a quarter covers what is still discussed. */
const LINKABLE_MONTHS = 3

/** What a claim was advanced on, in a few words: the expense and its day, or the financing. */
async function advancedOn(
  claim: Pick<OpenClaim, 'movement' | 'commitment'>,
  actorName: Map<string, string>,
): Promise<string> {
  const t = await getTranslations('movements.links')
  const format = await getFormat()
  if (claim.commitment) return t('onFinancing', { label: claim.commitment.label })
  const m = claim.movement!
  return t('onExpense', {
    label: actorName.get(m.targetActorId!) ?? '?',
    date: format.date(m.purchasedOn ?? m.happenedOn),
  })
}

/**
 * Names what each income in a list pays back ("Lea's share · Le Bistrot,
 * 10/05") or was received for ("Gym membership"), for the panel that corrects
 * it: the share and the commitment alone are ids. Keyed by that id.
 */
export async function refundLabels(
  userId: string,
  movements: Movement[],
  actorName: Map<string, string>,
): Promise<Map<string, string>> {
  const t = await getTranslations('movements.links')
  const described = await describeShares(
    userId,
    movements.flatMap((m) => (m.refundsShareId ? [m.refundsShareId] : [])),
  )
  const labels = new Map<string, string>()
  const reserved = new Set(movements.flatMap((m) => (m.reservesCommitmentId ? [m.reservesCommitmentId] : [])))
  if (reserved.size > 0)
    for (const c of await listCommitments(userId, false)) if (reserved.has(c.id)) labels.set(c.id, c.label)
  for (const [id, d] of described)
    labels.set(
      id,
      t('shareOf', {
        debtor: actorName.get(d.share.debtorActorId) ?? '?',
        on: await advancedOn(d, actorName),
      }),
    )
  return labels
}

/**
 * What an advance link can point at, for the movement panel: the claims
 * awaited and the recent expenses an income may pay back, the running
 * subscriptions and financings it may have been received for, the recent
 * plain incomes an expense may be paid back by.
 */
export async function linkChoices(
  userId: string,
  claims: OpenClaim[],
  actorName: Map<string, string>,
): Promise<{
  claims: LinkChoice[]
  expenses: LinkChoice[]
  commitments: LinkChoice[]
  incomes: LinkChoice[]
}> {
  const t = await getTranslations('movements.links')
  const format = await getFormat()
  const from = addPeriod(today(), 'month', -LINKABLE_MONTHS)
  const [expenses, incomes, running] = await Promise.all([
    listMovements(userId, { kind: 'expense', from, limit: 60 }),
    listMovements(userId, { kind: 'income', from, limit: 60 }),
    listCommitments(userId, true),
  ])
  const line = (m: Movement, who: string | null) =>
    t('movementOption', {
      label: actorName.get(who!) ?? '?',
      amount: format.eur(Number(m.amount), 2),
      date: format.date(m.purchasedOn ?? m.happenedOn),
    })
  return {
    claims: await Promise.all(
      claims.map(async (c) => ({
        value: `claim:${c.share.id}`,
        label: t('claimOption', {
          debtor: actorName.get(c.share.debtorActorId) ?? '?',
          remaining: format.eur(c.remaining, 2),
          on: await advancedOn(c, actorName),
        }),
      })),
    ),
    expenses: expenses.map((m) => ({ value: `movement:${m.id}`, label: line(m, m.targetActorId) })),
    // Only those whose occurrences are expenses, the ones a reserve is drawn by.
    commitments: running
      .filter((c) => c.kind === 'financing' || (c.kind === 'subscription' && c.direction === 'outgoing'))
      .map((c) => ({
        value: `reserve:${c.id}`,
        label: t('commitmentOption', { label: c.label, kind: c.kind }),
      })),
    // Only what pays nothing back yet and pays no invoice: those already say what they are.
    incomes: incomes
      .filter((m) => m.refundsShareId === null && m.reservesCommitmentId === null && m.invoiceId === null)
      .map((m) => ({ value: m.id, label: line(m, m.sourceActorId) })),
  }
}

export { openClaims }
