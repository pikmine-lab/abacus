import { DomainError } from './errors.ts'
import type { AdvanceFilter, ClaimState, Movement } from './types.ts'

/**
 * The share of an expense someone owes back, wherever it is stated: on one
 * movement, or once on a subscription whose every occurrence carries it.
 *
 * Who owes and how much travel together, because a claim without an amount
 * would silently mean "the whole expense", which is exactly the guess that
 * made splitting a bill inexpressible. The share is euros of the expense and
 * never more than it: nobody is owed back more than what was paid.
 */
export function checkRefundShare(
  debtor: string | null | undefined,
  share: number | null | undefined,
  amount: number,
): void {
  if (debtor && (share === undefined || share === null))
    throw new DomainError('advance_needs_amount', 'An advance needs the amount expected back')
  if (share !== undefined && share !== null && !debtor)
    throw new DomainError('advance_needs_actor', 'An expected refund needs the actor who owes it')
  if (share === undefined || share === null) return
  if (!(share > 0))
    throw new DomainError('advance_amount_invalid', 'The amount expected back must be positive')
  if (share > amount)
    throw new DomainError(
      'advance_amount_too_large',
      `The amount expected back (${share}) cannot exceed the expense (${amount})`,
    )
}

/**
 * Where an advance's claim stands, off a row the movement list returned: back
 * in full settles it, even when it was also closed; closed short of that is
 * written off. Null on anything that is not an advance. The list's
 * `advances` filter selects on the same three cases.
 */
export function claimState(
  m: Pick<Movement, 'expectedRefundAmount' | 'refundClosed' | 'refunded'>,
): ClaimState | null {
  if (m.expectedRefundAmount === null) return null
  if (Number(m.refunded ?? 0) >= Number(m.expectedRefundAmount)) return 'settled'
  return m.refundClosed ? 'written_off' : 'open'
}

/** Every value the movement list's `advances` filter takes, for the interfaces to validate against. */
export const ADVANCE_FILTERS = [
  'open',
  'settled',
  'written_off',
  'refunds',
] as const satisfies readonly AdvanceFilter[]
