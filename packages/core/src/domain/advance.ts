import { DomainError } from './errors.ts'
import type { AdvanceFilter, ClaimState, ShareInstallment, ShareState } from './types.ts'

/** Who owes part of what was advanced, and how much: the form both interfaces state shares in. */
export interface ShareInput {
  debtorActorId: string
  amount: number
}

/**
 * The shares stated on one thing advanced, against what it cost: one expense,
 * one occurrence, a financing's total. Who owes and how much travel together,
 * because a claim without an amount would silently mean "the whole expense",
 * the guess that made splitting a bill inexpressible. Each share is positive,
 * a person owes once on one thing, and the shares never add up to more than
 * what was paid: what they leave is the payer's own part, and they may cover
 * it all, a bill paid entirely for someone else.
 */
export function checkShares(shares: ShareInput[], cost: number, of = 'the expense'): void {
  const debtors = new Set<string>()
  let cents = 0
  for (const share of shares) {
    if (!share.debtorActorId)
      throw new DomainError('advance_needs_actor', 'An expected refund needs the actor who owes it')
    if (share.amount === undefined || share.amount === null || Number.isNaN(share.amount))
      throw new DomainError('advance_needs_amount', 'An advance needs the amount expected back')
    if (!(share.amount > 0))
      throw new DomainError('advance_amount_invalid', 'The amount expected back must be positive')
    if (debtors.has(share.debtorActorId))
      throw new DomainError(
        'share_debtor_repeated',
        'The same person is listed twice: what they owe is one share, the sum of both',
      )
    debtors.add(share.debtorActorId)
    cents += Math.round(share.amount * 100)
  }
  if (cents > Math.round(cost * 100))
    throw new DomainError(
      'advance_amount_too_large',
      `The shares expected back (${cents / 100}) cannot exceed ${of} (${cost})`,
    )
}

/** Where one share stands: back in full settles it, even when it was also closed. */
export function shareState(s: Pick<ShareState, 'amount' | 'refunded' | 'closed'>): ClaimState {
  if (Number(s.refunded) >= Number(s.amount)) return 'settled'
  return s.closed ? 'written_off' : 'open'
}

/**
 * Where an advanced expense stands, across its shares: open while anyone
 * still owes, written off when someone stopped short and nobody owes any
 * more, settled once every share is back. Null on anything that is not an
 * advance. The list's `advances` filter selects on the same three cases.
 */
export function claimState(m: {
  shares?: Pick<ShareState, 'amount' | 'refunded' | 'closed'>[]
}): ClaimState | null {
  if (!m.shares || m.shares.length === 0) return null
  const states = m.shares.map(shareState)
  if (states.includes('open')) return 'open'
  return states.includes('written_off') ? 'written_off' : 'settled'
}

/** Every value the movement list's `advances` filter takes, for the interfaces to validate against. */
export const ADVANCE_FILTERS = [
  'open',
  'settled',
  'written_off',
  'refunds',
] as const satisfies readonly AdvanceFilter[]

/** What a share's plan says today, against what came back. */
export interface ShareProgress {
  /** The next line not yet covered by what came back, and what is left of it. */
  nextDueOn: string | null
  nextDueAmount: number | null
  /** What the plan expected by today and has not come back: zero when on time. */
  lateAmount: number
}

/**
 * Reads a share's plan against its refunds, in total and never line by line:
 * a debtor who pays two lines at once, or half of one, is not matched to any
 * of them, the money simply covers the plan from its first line on. A share
 * written off or back in full expects nothing more, and one without a plan is
 * never late, since nobody said when.
 */
export function shareProgress(
  share: Pick<ShareState, 'amount' | 'refunded' | 'closed'>,
  plan: Pick<ShareInstallment, 'dueOn' | 'amount'>[],
  today: string,
): ShareProgress {
  const none = { nextDueOn: null, nextDueAmount: null, lateAmount: 0 }
  if (plan.length === 0 || shareState(share) !== 'open') return none
  const back = Math.round(Number(share.refunded) * 100)
  let planned = 0
  let expectedByToday = 0
  let next: { dueOn: string; left: number } | null = null
  for (const line of plan) {
    planned += Math.round(Number(line.amount) * 100)
    if (line.dueOn <= today) expectedByToday = planned
    if (!next && planned > back) next = { dueOn: line.dueOn, left: planned - back }
  }
  return {
    nextDueOn: next?.dueOn ?? null,
    nextDueAmount: next ? next.left / 100 : null,
    lateAmount: Math.max(0, expectedByToday - back) / 100,
  }
}
