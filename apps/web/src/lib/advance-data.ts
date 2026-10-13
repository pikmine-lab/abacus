import type { Movement } from '@abacus/core/domain'
import { actorNames } from '@abacus/core/services/actors'
import { describeShares, linkCandidates, type OpenClaim, openClaims } from '@abacus/core/services/advances'
import { getTranslations } from 'next-intl/server'
import type { LinkChoice } from '@/components/advance-links'
import { getFormat } from '@/lib/format-server'

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
 * Names what each refund in a list pays back ("Lea's share · Le Bistrot,
 * 10/05"), for the panel that corrects it: the share alone is an id.
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
 * Movements as a link offers them: who, how much, and when. An expense is
 * valued `movement:<id>`, apart from the claims it is listed with; an income
 * by its id alone.
 */
async function movementChoices(
  side: 'expense' | 'income',
  movements: Movement[],
  actorName: Map<string, string>,
): Promise<LinkChoice[]> {
  const t = await getTranslations('movements.links')
  const format = await getFormat()
  return movements.map((m) => ({
    value: side === 'expense' ? `movement:${m.id}` : m.id,
    label: t('movementOption', {
      label: actorName.get((side === 'income' ? m.sourceActorId : m.targetActorId)!) ?? '?',
      amount: format.eur(Number(m.amount), 2),
      date: format.date(m.purchasedOn ?? m.happenedOn),
    }),
  }))
}

/** How many of the latest movements a link offers before anything is typed. */
const RECENT = 5

/**
 * What an advance link offers when it opens, for the movement panel: the
 * claims awaited and the latest expenses an income may pay back, the latest
 * plain incomes an expense may be paid back by. The rest of the history is
 * searched (`searchLinkChoices`), never listed.
 */
export async function linkChoices(
  userId: string,
  claims: OpenClaim[],
  actorName: Map<string, string>,
): Promise<{ claims: LinkChoice[]; expenses: LinkChoice[]; incomes: LinkChoice[] }> {
  const t = await getTranslations('movements.links')
  const format = await getFormat()
  const [expenses, incomes] = await Promise.all([
    linkCandidates(userId, 'expense', undefined, RECENT),
    linkCandidates(userId, 'income', undefined, RECENT),
  ])
  return {
    claims: await Promise.all(
      claims.map(async (c) => {
        const debtor = actorName.get(c.share.debtorActorId) ?? '?'
        const on = await advancedOn(c, actorName)
        return {
          value: `claim:${c.share.id}`,
          label: t('claimOption', { debtor, remaining: format.eur(c.remaining, 2), on }),
          // Searched by what the reader remembers of it, as a movement is.
          search: {
            texts: [debtor, on, c.movement?.note ?? ''],
            amounts: [
              c.remaining,
              Number(c.share.amount),
              ...(c.movement ? [Number(c.movement.amount)] : []),
            ],
          },
        }
      }),
    ),
    expenses: await movementChoices('expense', expenses, actorName),
    incomes: await movementChoices('income', incomes, actorName),
  }
}

/**
 * The movements a link finds for what was typed, across the whole history,
 * valued as `linkChoices` values them on the same side.
 */
export async function searchLinkChoices(
  userId: string,
  side: 'expense' | 'income',
  search: string,
): Promise<LinkChoice[]> {
  const found = await linkCandidates(userId, side, search)
  const actorName = await actorNames(
    userId,
    found.flatMap((m) => {
      const id = side === 'income' ? m.sourceActorId : m.targetActorId
      return id ? [id] : []
    }),
  )
  return await movementChoices(side, found, actorName)
}

export { openClaims }
