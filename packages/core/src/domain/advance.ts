import { DomainError } from './errors.ts'

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
