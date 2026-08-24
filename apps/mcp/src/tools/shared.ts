import { DomainError } from '@abacus/core/domain/errors'
import * as z from 'zod'

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }] }
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Actionable guidance for domain errors raised below the MCP layer. */
export const GUIDANCE: Record<string, string> = {
  account_closed: 'This account is closed at that date. Check the movement date or the targeted account.',
  transfer_has_no_category:
    'An internal transfer never carries a category: drop it, categories only apply to expenses and incomes.',
  transfer_has_no_accrual:
    'An internal transfer enters no period total, so it is about no month: drop month. Only an expense or an income can be attached to another month.',
  transfer_is_never_ghost:
    'An internal transfer already counts in no analysis: drop ghost. Only an expense or an income can be left out of one.',
  bad_month:
    'A month is written YYYY-MM (2026-08). Pass the month the movement is about, not a description of it.',
  not_an_advance:
    'The referenced movement is not marked as an advance, so a refund cannot be linked to it. Check the id with list_outstanding_advances.',
  advance_needs_amount:
    'An advance says how much is owed back: pass expectedRefundAmount alongside expectedRefundFrom. Ask the user for the share if it was not stated, rather than assuming the whole expense.',
  advance_needs_actor:
    'An expected refund needs the actor who owes it: pass expectedRefundFrom alongside expectedRefundAmount.',
  advance_amount_invalid: 'The amount expected back must be a positive number of euros.',
  advance_amount_too_large:
    'You cannot be owed back more than what left the account: the expected refund must not exceed the movement amount.',
  advance_is_expense:
    'Only an expense can be advanced for someone: a transfer between owned accounts or an income cannot be owed back.',
  advance_has_refund:
    'A refund is already linked to this advance, so the claim cannot be dropped: delete that refund movement first if it never happened.',
  advance_below_refunds:
    'The amount expected back would be lower than what has already been refunded. Raise it, or correct the refund movement instead.',
  advance_settled:
    'This advance is already refunded in full: there is nothing left to bring back. Check list_outstanding_advances.',
  transfer_stays_eur:
    'A transfer between two owned accounts moves euros: declare it in euros, without a currency.',
  needless_eur_amount:
    'eurAmount only goes with a foreign currency: the amount is already in euros, so drop one of the two.',
  no_exchange_rate:
    'No rate is known for that currency on that date. Check the ISO code (USD, GBP…); if it is right, ask the user for the euros the bank moved and pass them as eurAmount.',
  bad_currency: 'A currency is a three-letter ISO 4217 code other than EUR: USD, GBP, CHF…',
  financing_keeps_currency:
    'A financing plan is written in its currency for its whole life. To change it, the honest way is to close this financing and declare the new plan.',
  financing_settled: 'Every installment of this financing is already paid: it is settled.',
  cancelled: 'This commitment is cancelled: there is no occurrence left to confirm.',
  already_cancelled: 'This commitment is already cancelled.',
  no_gap: 'This balance check has no gap: nothing to settle.',
  actor_exists:
    'This name or alias already resolves to an existing actor: reuse it instead of creating a duplicate.',
  alias_taken: 'This alias already resolves to an actor: pick another one or merge the actors.',
  merge_self: 'An actor cannot be merged into itself.',
  not_a_subscription: 'Only subscriptions carry a judgment (essential / reducible / to_cancel).',
  movement_not_found:
    'No such movement for this user. Get a current id from list_movements: an id from an earlier answer may already be gone.',
  refunded_movement:
    'Another movement refunds this one, so deleting it would leave that refund pointing at nothing. Delete the refund first, or correct this movement instead.',
  financing_needs_amount: 'A financing needs its total amount (totalAmount) over N installments.',
  schedule_length_mismatch:
    'The schedule you passed has a different number of installments than installmentsTotal: make them match.',
  schedule_sum_mismatch:
    'The installments do not add up to the total. Fix one or the other: a plan that does not sum to what is owed would make the remaining due wrong.',
  cannot_skip_financing:
    'A financing installment cannot be skipped: it is owed. Confirm it when it is paid, or cancel the financing if the plan ended early.',
  not_a_financing:
    'Only a financing carries a written schedule. A subscription is open-ended: change its amount with manage_subscription.',
  financing_has_no_lock_in:
    'A financing ends at its last installment, so it has no lock-in date. A lock-in period only makes sense on a subscription.',
  schedule_empty:
    'A revision cannot leave a financing without a single installment. To end it early, either revise it down to the installments that remain owed, or cancel it with manage_subscription.',
  installment_not_found:
    'No installment with that id in this financing. Call manage_financing_schedule with action show to get the current ids: they change when a line is dropped.',
  installment_repeated:
    'The same installment id appears twice in the revision. Each line of the plan is one installment: use one entry per installment, and omit the id to add a new one.',
  bad_source: 'A movement needs exactly one source: an owned account or an external actor, never both.',
  bad_target: 'A movement needs exactly one target: an owned account or an external actor, never both.',
  no_owned_account:
    "A movement must touch at least one of the user's own accounts. Actor-to-actor is not something this app records.",
  account_exists:
    'An account already uses that name. Reuse it, or pick another: two accounts cannot share one.',
  account_has_operations:
    'This account holds investment operations, which only an investment account can hold: its behavior cannot change. Everything else about it still corrects.',
  category_exists: 'A category already uses that name. Reuse it instead of creating a variant of it.',
  activity_exists:
    'An activity already uses that name. Reuse it: activities partition the finances, duplicates defeat that.',
  check_not_found:
    'No such balance check for this user. Get a current id from manage_balance_checks with action list.',
  check_already_settled:
    'An adjustment already settles this check. Correct or delete that movement with fix_movement, or correct the check itself with manage_balance_checks.',
  not_an_investment_account:
    'Only an investment account carries operations. Money reaching or leaving that account is a plain movement (declare_movements); what happens inside it is an operation.',
  oversold:
    'That would sell more than the account holds. Check the quantity, and check the account: a holding bought on one account cannot be sold from another.',
  needs_quantity: 'A buy or a sell needs the quantity it moved, not just the amount.',
  unexpected_quantity: 'Only a buy or a sell moves a quantity. A dividend and a fee are amounts alone.',
  needs_asset: 'This operation is about an asset: name the one it concerns.',
  no_operations: 'There is nothing to record: pass at least one operation.',
  asset_has_operations:
    'This asset carries operations, so it is part of the history: forgetting it would take a position and its cost with it. Delete its operations with fix_investment_operation first, or keep it.',
  operation_not_found:
    'No such operation for this user. Get a current id from list_investment_operations: an id from an earlier answer may already be gone.',
  amount_or_unit_price:
    'An operation carries either a total amount or a unit price, not both: passing both would state two different totals. Pick the one the user actually gave.',
  asset_exists:
    'That name is taken, or that instrument is already held under another name. Reuse it: one instrument held twice would split the position in half.',
  asset_is_quoted:
    'This asset follows a price source, so its price comes from the market: a hand-typed one would be a second answer to the same question. Only an asset declared without a source takes set_price.',
  // asset_not_found stays out on purpose, like the other name resolutions: the
  // resolver's own message lists what is held, which is what unblocks the call.
}

/** Optional text fields where the AI clears a value by passing "none". */
export function clearable(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : value.toLowerCase() === 'none' ? null : value
}

function toFailure(e: unknown): ToolResult {
  if (e instanceof DomainError) return fail(GUIDANCE[e.code] ?? e.message)
  throw e
}

export async function run(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await handler()
  } catch (e) {
    return toFailure(e)
  }
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date in YYYY-MM-DD format')
