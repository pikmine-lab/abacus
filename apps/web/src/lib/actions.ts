'use server'

import { auth } from '@abacus/core/auth'
import type { AccountBehavior, Judgment, PeriodUnit } from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import { closeAccount, createAccount, editAccount, reopenAccount } from '@abacus/core/services/accounts'
import { addAlias, createActor, editActor, mergeActors, resolveActor } from '@abacus/core/services/actors'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  recordBalanceCheck,
} from '@abacus/core/services/balanceChecks'
import { createActivity, createCategory, editActivity, editCategory } from '@abacus/core/services/catalog'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  editCommitment,
  moveAccount,
  reviseSchedule,
  setJudgment,
  skipNextOccurrence,
} from '@abacus/core/services/commitments'
import {
  correctOperation,
  declareAsset,
  deleteOperation,
  editAsset,
  recordOperations,
  setManualPrice,
  stopFollowing,
} from '@abacus/core/services/investments'
import {
  closeAdvance,
  correctMovement,
  declareMovement,
  deleteMovement,
  refundAdvance,
} from '@abacus/core/services/movements'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export interface FormState {
  /** Message that belongs to the form as a whole (a rejected domain rule). */
  error?: string
  /** Messages that belong to one field each, keyed by its input name. */
  fields?: Record<string, string>
  ok?: boolean
}

/**
 * What a field must be for the form to make sense. Validation lives here, not
 * in HTML `required`: a Radix Select has no native validatable input, so the
 * browser used to anchor its bubble on some other field entirely, and native
 * bubbles break out of the interface anyway.
 */
type FieldKind = 'text' | 'amount' | 'count' | 'date'

interface FieldRule {
  name: string
  kind?: FieldKind
}

function checkFields(formData: FormData, rules: FieldRule[]): Record<string, string> | null {
  const errors: Record<string, string> = {}
  for (const { name, kind = 'text' } of rules) {
    const raw = str(formData, name)
    if (raw === '') {
      errors[name] = 'À renseigner.'
      continue
    }
    if (kind === 'amount') {
      const value = num(formData, name)
      if (!Number.isFinite(value)) errors[name] = 'Montant invalide.'
      else if (value <= 0) errors[name] = 'Doit être supérieur à zéro.'
    }
    if (kind === 'count') {
      const value = num(formData, name)
      if (!Number.isInteger(value) || value < 2) errors[name] = 'Au moins 2 échéances.'
    }
    if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors[name] = 'Date invalide.'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

const FR: Record<string, string> = {
  account_closed: 'Ce compte est clos à cette date.',
  transfer_has_no_category: 'Un virement interne ne porte pas de catégorie.',
  not_an_advance: 'Le mouvement visé n’est pas une avance.',
  financing_settled: 'Ce financement est déjà soldé.',
  not_a_financing: 'Seul un financement porte un échéancier écrit.',
  schedule_empty: 'Un financement garde au moins une échéance : clos-le plutôt que de vider son plan.',
  installment_not_found: 'Une échéance de ce plan n’existe plus : rouvre le panneau pour repartir à jour.',
  installment_repeated: 'La même échéance apparaît deux fois dans le plan.',
  cancelled: 'Cet engagement est résilié.',
  already_cancelled: 'Cet engagement est déjà résilié.',
  no_gap: 'Ce pointage n’a aucun écart à solder.',
  actor_exists: 'Ce nom désigne déjà un acteur existant.',
  bad_source: 'Il manque le compte ou l’acteur source.',
  bad_target: 'Il manque le compte ou l’acteur destination.',
  no_owned_account: 'Un mouvement doit toucher au moins un de tes comptes.',
  movement_not_found: 'Ce mouvement n’existe plus.',
  refunded_movement: 'Un remboursement est lié à ce mouvement : supprime d’abord le remboursement.',
  account_exists: 'Un compte porte déjà ce nom.',
  account_not_found: 'Ce compte n’existe plus.',
  account_has_operations:
    'Ce compte porte des opérations d’investissement : son type ne change plus. Le reste se corrige.',
  actor_not_found: 'Cet acteur n’existe plus.',
  category_exists: 'Une catégorie porte déjà ce nom.',
  category_not_found: 'Cette catégorie n’existe plus.',
  activity_exists: 'Une activité porte déjà ce nom.',
  activity_not_found: 'Cette activité n’existe plus.',
  check_not_found: 'Ce pointage n’existe plus.',
  check_already_settled: 'Un ajustement solde déjà ce pointage.',
  financing_has_no_lock_in: 'Un financement s’arrête à sa dernière échéance : pas de date de fin.',
  alias_taken: 'Ce nom désigne déjà un acteur : fusionne-les plutôt que d’ajouter cet alias.',
  merge_self: 'Un acteur ne se fusionne pas avec lui-même.',
  advance_needs_amount: 'Indique la part attendue en remboursement.',
  advance_needs_actor: 'Indique qui doit rembourser cette part.',
  advance_amount_invalid: 'La part attendue doit être supérieure à zéro.',
  advance_amount_too_large: 'La part attendue ne peut pas dépasser le montant de la dépense.',
  advance_is_expense: 'Seule une dépense peut être avancée pour quelqu’un.',
  advance_has_refund:
    'Un remboursement est déjà lié à cette avance : supprime-le avant de retirer la créance.',
  advance_below_refunds: 'La part attendue est déjà dépassée par ce qui a été remboursé.',
  advance_settled: 'Cette avance est déjà remboursée en entier.',
  not_an_investment_account:
    'Seul un compte d’investissement porte des opérations. Alimenter ce compte est un virement.',
  operation_not_found: 'Cette opération n’existe plus.',
  asset_is_quoted: 'Cet actif prend son cours à sa source : un cours saisi ferait double emploi.',
  asset_has_operations:
    'Cet actif porte des opérations : elles font l’histoire du compte. Supprime-les d’abord, ou garde-le.',
  oversold: 'Tu vends plus que ce compte détient. Vérifie la quantité, et le compte.',
  needs_quantity: 'Un achat ou une vente porte une quantité.',
  needs_asset: 'Indique l’actif concerné.',
  asset_exists: 'Ce nom est pris, ou tu détiens déjà cet instrument sous un autre nom.',
  asset_not_found: 'Cet actif n’existe plus.',
}

/**
 * The periodicity travels as one field ("month:3"), because the interface asks
 * it as one question ("tous les 3 mois") rather than as a unit and a multiple
 * to combine.
 */
function period(formData: FormData): { periodUnit: PeriodUnit; periodCount: number } | null {
  const [unit, count] = str(formData, 'period').split(':')
  if (!/^(week|month|year)$/.test(unit ?? '') || !Number.isInteger(Number(count)) || Number(count) < 1)
    return null
  return { periodUnit: unit as PeriodUnit, periodCount: Number(count) }
}

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  return session.user.id
}

function frError(e: unknown): string {
  if (e instanceof DomainError) return FR[e.code] ?? e.message
  if ((e as { code?: string }).code === '23505') return 'Ce nom existe déjà.'
  throw e
}

/** Amounts may arrive grouped ("2 000,50") from the formatted input. */
function num(formData: FormData, key: string): number {
  return Number(
    String(formData.get(key) ?? '')
      .replace(/[\s\u202f\u00a0]/g, '')
      .replace(',', '.'),
  )
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function opt(formData: FormData, key: string): string | undefined {
  const v = str(formData, key)
  return v === '' ? undefined : v
}

/**
 * UI actor entry: the field autocompletes on existing names and aliases, so a
 * non-matching name typed here is a deliberate new actor, not a typo to guard
 * against (the MCP flow, blind, stays strict with suggestions instead).
 */
async function actorIdFromName(userId: string, name: string): Promise<string> {
  const { match } = await resolveActor(userId, name)
  if (match) return match.id
  return (await createActor(userId, { name })).id
}

/**
 * Every declaration moves a balance, a total or a due date, so every view is
 * stale afterwards. Listing the routes beats revalidating a tag per entity for
 * an app of this size: but it does have to list them all.
 */
function refreshAll() {
  for (const path of [
    '/',
    '/movements',
    '/analysis',
    '/recurring-expenses',
    '/recurring-income',
    '/accounts',
    '/investments',
    '/settings',
  ])
    revalidatePath(path)
}

/**
 * Where to send an error that cannot be shown in place (actions returning
 * void, submitted from a plain form). The caller passes its own pathname, so
 * the same action serves the pages that share these forms.
 */
function errorRedirect(formData: FormData, message: string): never {
  const back = str(formData, 'back') || '/recurring-expenses'
  redirect(`${back}?error=${encodeURIComponent(message)}`)
}

/** The fields a movement needs, which depend on the kind being declared. */
function movementRules(type: string): FieldRule[] {
  return [
    { name: 'date', kind: 'date' },
    { name: 'amount', kind: 'amount' },
    { name: 'accountId' },
    type === 'transfer' ? { name: 'toAccountId' } : { name: 'actor' },
  ]
}

export async function declareMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const type = str(formData, 'type')
  const invalid = checkFields(formData, movementRules(type))
  if (invalid) return { fields: invalid }
  try {
    const accountId = str(formData, 'accountId')
    const actorName = opt(formData, 'actor')
    let endpoints: Record<string, string | undefined>
    if (type === 'transfer') {
      endpoints = { sourceAccountId: accountId, targetAccountId: opt(formData, 'toAccountId') }
    } else {
      if (!actorName) return { error: 'Indique la contrepartie (commerçant, client, organisme).' }
      const actorId = await actorIdFromName(userId, actorName)
      endpoints =
        type === 'expense'
          ? { sourceAccountId: accountId, targetActorId: actorId }
          : { sourceActorId: actorId, targetAccountId: accountId }
    }
    const expectedRefundFrom = opt(formData, 'expectedRefundFrom')
    await declareMovement(userId, {
      happenedOn: str(formData, 'date'),
      amount: num(formData, 'amount'),
      ...endpoints,
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
      note: opt(formData, 'note'),
      refundsMovementId: opt(formData, 'refundsMovementId'),
      expectedRefundFromActorId: expectedRefundFrom
        ? await actorIdFromName(userId, expectedRefundFrom)
        : undefined,
      expectedRefundAmount: expectedRefundFrom ? num(formData, 'expectedRefundAmount') : undefined,
      refundedNow: expectedRefundFrom ? formData.get('refundedNow') !== null : undefined,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Corrects a declared movement. Same shape as the declaration form, so the
 * endpoints are rebuilt from the chosen type rather than patched field by
 * field: a dépense turned into a virement has to lose its actor.
 */
export async function correctMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const type = str(formData, 'type')
  const invalid = checkFields(formData, movementRules(type))
  if (invalid) return { fields: invalid }
  try {
    const accountId = str(formData, 'accountId')
    const actorName = opt(formData, 'actor')
    let endpoints: Record<string, string | null>
    if (type === 'transfer') {
      endpoints = {
        sourceAccountId: accountId,
        targetAccountId: opt(formData, 'toAccountId') ?? null,
        sourceActorId: null,
        targetActorId: null,
      }
    } else {
      if (!actorName) return { error: 'Indique la contrepartie (commerçant, client, organisme).' }
      const actorId = await actorIdFromName(userId, actorName)
      endpoints =
        type === 'expense'
          ? {
              sourceAccountId: accountId,
              targetActorId: actorId,
              sourceActorId: null,
              targetAccountId: null,
            }
          : {
              sourceActorId: actorId,
              targetAccountId: accountId,
              sourceAccountId: null,
              targetActorId: null,
            }
    }
    // Only an expense can be an advance, so switching a movement away from
    // expense drops the claim rather than colliding with the domain rule.
    const expectedRefundFrom = type === 'expense' ? opt(formData, 'expectedRefundFrom') : undefined
    await correctMovement(userId, str(formData, 'movementId'), {
      happenedOn: str(formData, 'date'),
      amount: num(formData, 'amount'),
      ...endpoints,
      categoryId: opt(formData, 'categoryId') ?? null,
      activityId: opt(formData, 'activityId') ?? null,
      note: opt(formData, 'note') ?? null,
      expectedRefundFromActorId: expectedRefundFrom
        ? await actorIdFromName(userId, expectedRefundFrom)
        : null,
      expectedRefundAmount: expectedRefundFrom ? num(formData, 'expectedRefundAmount') : null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteMovement(userId, str(formData, 'movementId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function recordBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  // A real balance can legitimately be zero or negative, so only its shape is
  // checked here.
  const raw = str(formData, 'balance')
  if (raw === '') return { fields: { balance: 'À renseigner.' } }
  if (!Number.isFinite(num(formData, 'balance'))) return { fields: { balance: 'Montant invalide.' } }
  try {
    await recordBalanceCheck(userId, str(formData, 'accountId'), num(formData, 'balance'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Corrects a recorded check. Correcting one is re-checking: the gap is
 * recomputed for the date given, and the adjustment that settled the old one
 * follows (realigned, or removed when nothing is left to settle).
 */
export async function correctBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const raw = str(formData, 'balance')
  if (raw === '') return { fields: { balance: 'À renseigner.' } }
  if (!Number.isFinite(num(formData, 'balance'))) return { fields: { balance: 'Montant invalide.' } }
  const invalid = checkFields(formData, [{ name: 'checkedOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await correctBalanceCheck(userId, str(formData, 'checkId'), {
      declaredBalance: num(formData, 'balance'),
      checkedOn: str(formData, 'checkedOn'),
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Settles a gap in one movement, attributed to an actor. Last resort: declaring
 * the movements that are actually missing is the right answer, and the panel
 * says so. The note is prefilled rather than defaulted server-side, so what
 * lands in the ledger is what the user read.
 */
export async function settleCheckGapAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'actor' }])
  if (invalid) return { fields: invalid }
  try {
    await createAdjustment(userId, str(formData, 'checkId'), {
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      categoryId: opt(formData, 'categoryId'),
      note: opt(formData, 'note'),
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteBalanceCheck(userId, str(formData, 'checkId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createAccount({
      userId,
      name: str(formData, 'name'),
      behavior: str(formData, 'behavior') as 'payment' | 'savings' | 'investment',
      institution: opt(formData, 'institution') ?? null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/** What an account says about itself. Its balance is history, never edited here. */
export async function editAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editAccount(userId, str(formData, 'accountId'), {
      name: str(formData, 'name'),
      institution: opt(formData, 'institution') ?? null,
      behavior: str(formData, 'behavior') as AccountBehavior,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function reopenAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await reopenAccount(userId, str(formData, 'accountId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function closeAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await closeAccount(userId, str(formData, 'accountId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [
    { name: 'label' },
    { name: 'actor' },
    { name: 'accountId' },
    { name: 'amount', kind: 'amount' },
    { name: 'firstDueOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: 'À renseigner.' } }
  try {
    await createSubscription(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      direction: str(formData, 'direction') === 'incoming' ? 'incoming' : 'outgoing',
      amount: num(formData, 'amount'),
      ...every,
      firstDueOn: str(formData, 'firstDueOn'),
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
      judgment: opt(formData, 'judgment') as Judgment | undefined,
      engagedUntil: opt(formData, 'engagedUntil'),
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The schedule as edited line by line, or undefined when the editor was left
 * closed. Dates and amounts arrive as parallel lists in contractual order,
 * which is the order the rows were rendered in.
 */
function scheduleFrom(formData: FormData): { dueOn: string; amount: number }[] | undefined {
  const dates = formData.getAll('installmentDueOn').map(String)
  const amounts = formData.getAll('installmentAmount').map(String)
  if (dates.length === 0 || dates.length !== amounts.length) return undefined
  return dates.map((dueOn, index) => ({
    dueOn,
    amount: Number(amounts[index]!.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')),
  }))
}

export async function createFinancingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [
    { name: 'label' },
    { name: 'actor' },
    { name: 'accountId' },
    { name: 'totalAmount', kind: 'amount' },
    { name: 'installmentsTotal', kind: 'count' },
    { name: 'firstDueOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: 'À renseigner.' } }
  try {
    await createFinancing(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      totalAmount: num(formData, 'totalAmount'),
      installmentsTotal: num(formData, 'installmentsTotal'),
      firstDueOn: str(formData, 'firstDueOn'),
      ...every,
      // Present only when the schedule editor was opened; otherwise the plan
      // is generated from the total.
      installments: scheduleFrom(formData),
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Revises the plan of an existing financing. The panel sends the whole plan,
 * one parallel list per column, in the order the rows were rendered: that
 * order is the contractual order, and an empty id marks a line being added.
 */
export async function reviseScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const ids = formData.getAll('installmentId').map(String)
  const lines = scheduleFrom(formData)
  if (!lines)
    return { error: 'Un financement garde au moins une échéance : clos-le plutôt que de vider son plan.' }
  if (lines.some((line) => !/^\d{4}-\d{2}-\d{2}$/.test(line.dueOn) || !(line.amount > 0)))
    return { error: 'Chaque échéance a besoin d’une date et d’un montant supérieur à zéro.' }
  try {
    await reviseSchedule(
      userId,
      str(formData, 'commitmentId'),
      lines.map((line, index) => ({ id: ids[index] || undefined, ...line })),
    )
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function confirmOccurrenceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await confirmNextOccurrence(userId, str(formData, 'commitmentId'), {
      amount: opt(formData, 'amount') ? num(formData, 'amount') : undefined,
      happenedOn: opt(formData, 'date'),
      // "It is the new normal": historises the change instead of treating it
      // as a one-off month.
      updateReference: formData.get('newAmount') !== null,
    })
  } catch (e) {
    errorRedirect(formData, frError(e))
  }
  refreshAll()
}

export async function skipOccurrenceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await skipNextOccurrence(userId, str(formData, 'commitmentId'))
  } catch (e) {
    errorRedirect(formData, frError(e))
  }
  refreshAll()
}

export async function setJudgmentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const judgment = str(formData, 'judgment')
  if (judgment === '') return
  await setJudgment(userId, str(formData, 'commitmentId'), judgment as Judgment)
  refreshAll()
}

/**
 * Corrects what a commitment says about itself. Neither the amount nor the
 * account is here: both are dated histories with their own gesture, and a
 * financing's amount comes from its schedule.
 */
export async function editCommitmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'label' }, { name: 'actor' }])
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: 'À renseigner.' } }
  try {
    await editCommitment(userId, str(formData, 'commitmentId'), {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      categoryId: opt(formData, 'categoryId') ?? null,
      activityId: opt(formData, 'activityId') ?? null,
      ...every,
      // Financings never carry one, and the panel does not show the field for
      // them: an empty value clears it rather than being refused.
      engagedUntil: opt(formData, 'engagedUntil') ?? null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Moves the debit (or credit) to another account, from a date. Dated because a
 * move is usually known before it happens, and because an occurrence confirmed
 * afterwards must still land on the account the money really left.
 */
export async function changeCommitmentAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'accountId' }, { name: 'effectiveOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await moveAccount(
      userId,
      str(formData, 'commitmentId'),
      str(formData, 'accountId'),
      str(formData, 'effectiveOn'),
    )
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function changePriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'amount', kind: 'amount' }])
  if (invalid) return { fields: invalid }
  try {
    await changeAmount(userId, str(formData, 'commitmentId'), num(formData, 'amount'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function cancelCommitmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await cancelCommitment(userId, str(formData, 'commitmentId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * "It came back": writes the income that closes the claim. The amount is
 * editable on the way, because a refund arrives partial as often as whole.
 */
export async function refundAdvanceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await refundAdvance(userId, str(formData, 'movementId'), {
      amount: opt(formData, 'amount') ? num(formData, 'amount') : undefined,
      on: opt(formData, 'date'),
    })
  } catch (e) {
    errorRedirect(formData, frError(e))
  }
  refreshAll()
}

export async function closeAdvanceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await closeAdvance(userId, str(formData, 'movementId'))
  } catch (e) {
    errorRedirect(formData, frError(e))
  }
  refreshAll()
}

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createCategory(userId, str(formData, 'name'), opt(formData, 'group'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Renames a category, or moves it to another group. Nothing has to follow:
 * what is filed under it points at the category, not at its name.
 */
export async function editCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editCategory(userId, str(formData, 'categoryId'), {
      name: str(formData, 'name'),
      groupLabel: opt(formData, 'group') ?? null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function editActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editActivity(userId, str(formData, 'activityId'), str(formData, 'name'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Corrects an actor. The former name is replaced, not kept as an alias: a typo
 * has to stop resolving. A name that really was in use gets added as an alias
 * instead, deliberately.
 */
export async function editActorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editActor(userId, str(formData, 'actorId'), {
      name: str(formData, 'name'),
      activityId: opt(formData, 'activityId') ?? null,
      note: opt(formData, 'note') ?? null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Records another name that resolves to this actor. The correction panel
 * replaces a name; this keeps one, which is the difference between a typo and
 * a name that was really in use.
 */
export async function addAliasAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'alias' }])
  if (invalid) return { fields: invalid }
  try {
    await addAlias(userId, str(formData, 'actorId'), str(formData, 'alias'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Absorbs this actor into another: the whole history moves and its name becomes
 * an alias of the one kept, so the duplicate cannot come back through a
 * declaration. The only gesture here that rewrites what is already recorded.
 */
export async function mergeActorsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'keepId' }])
  if (invalid) return { fields: invalid }
  try {
    await mergeActors(userId, str(formData, 'keepId'), str(formData, 'actorId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createActorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createActor(userId, { name: str(formData, 'name') })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createActivity(userId, str(formData, 'name'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export interface ApiKeyFormState extends FormState {
  /** Plain key value: returned once at creation, never retrievable again. */
  key?: string
}

export async function createApiKeyAction(
  _prev: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const created = await auth.api.createApiKey({
    body: { name: str(formData, 'name') },
    headers: await headers(),
  })
  revalidatePath('/connect-ai')
  return { ok: true, key: created.key }
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  await auth.api.deleteApiKey({
    body: { keyId: str(formData, 'keyId') },
    headers: await headers(),
  })
  revalidatePath('/connect-ai')
}

/**
 * What the user holds. A listed asset names where its price comes from; without
 * a source it is priced by hand, and nothing more is asked.
 */
export async function declareAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const source = opt(formData, 'source')
  const invalid = checkFields(
    formData,
    source ? [{ name: 'name' }, { name: 'reference' }] : [{ name: 'name' }],
  )
  if (invalid) return { fields: invalid }
  try {
    await declareAsset(userId, {
      name: str(formData, 'name'),
      instrument: source
        ? {
            kind: str(formData, 'kind') as 'security' | 'crypto',
            priceSource: source as 'yahoo' | 'coingecko',
            priceSourceRef: str(formData, 'reference'),
            name: opt(formData, 'description') ?? str(formData, 'name'),
          }
        : undefined,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function renameAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editAsset(userId, str(formData, 'assetId'), str(formData, 'name'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * One operation per submit: the panel stays open and empties itself, because
 * declaring happens in bursts. The batch API exists for the MCP, which receives
 * a whole session at once.
 *
 * The asset may not exist yet: looking for what one bought belongs to the moment
 * one declares the purchase, not to a separate errand beforehand. Declaring it
 * is idempotent, so a rejected line can be corrected and sent again without
 * tripping over the asset it already created.
 */
export async function recordOperationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const type = str(formData, 'type') as 'buy' | 'sell' | 'dividend' | 'fee'
  const trade = type === 'buy' || type === 'sell'
  // A trade may be declared by its unit price instead of its total: that is what
  // a broker displays, and reconstructing a total from a valuation would fold
  // the difference between two venues' prices into the cost basis.
  const unitPriced = trade && opt(formData, 'unitPrice') !== undefined
  const rules: FieldRule[] = [
    { name: 'operatedOn', kind: 'date' },
    { name: unitPriced ? 'unitPrice' : 'amount', kind: 'amount' },
  ]
  if (trade) rules.push({ name: 'quantity', kind: 'amount' })
  const source = opt(formData, 'source')
  const picked = opt(formData, 'reference')
  if (type !== 'fee' && !picked) rules.push({ name: 'assetId' })
  const invalid = checkFields(formData, rules)
  if (invalid) return { fields: invalid }
  const quantity = trade ? num(formData, 'quantity') : undefined

  let assetId = opt(formData, 'assetId')
  if (picked) {
    try {
      const asset = await declareAsset(userId, {
        name: str(formData, 'assetName'),
        instrument: {
          kind: str(formData, 'kind') as 'security' | 'crypto',
          priceSource: source as 'yahoo' | 'coingecko',
          priceSourceRef: picked,
          name: opt(formData, 'description') ?? str(formData, 'assetName'),
          isin: opt(formData, 'isin') ?? null,
        },
      })
      assetId = asset.id
    } catch (e) {
      return { error: frError(e) }
    }
  }
  try {
    await recordOperations(userId, [
      {
        accountId: str(formData, 'accountId'),
        assetId,
        type,
        quantity,
        // One place turns a unit price into a total: the service, so both
        // interfaces round it the same way.
        amount: unitPriced ? undefined : num(formData, 'amount'),
        unitPrice: unitPriced ? num(formData, 'unitPrice') : undefined,
        operatedOn: str(formData, 'operatedOn'),
        note: opt(formData, 'note'),
      },
    ])
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Corrects a declared operation. Its type and its asset are not here: changing
 * either would make it another operation, which is a deletion and a new
 * declaration, said plainly.
 */
export async function correctOperationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const trade = str(formData, 'trade') === 'true'
  const rules: FieldRule[] = [
    { name: 'operatedOn', kind: 'date' },
    { name: 'amount', kind: 'amount' },
  ]
  if (trade) rules.push({ name: 'quantity', kind: 'amount' })
  const invalid = checkFields(formData, rules)
  if (invalid) return { fields: invalid }
  try {
    await correctOperation(userId, str(formData, 'operationId'), {
      accountId: opt(formData, 'accountId'),
      quantity: trade ? num(formData, 'quantity') : undefined,
      amount: num(formData, 'amount'),
      operatedOn: str(formData, 'operatedOn'),
      note: opt(formData, 'note') ?? null,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteOperationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteOperation(userId, str(formData, 'operationId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/** A price for what no source quotes: an SCPI revalued, a flat reappraised. */
export async function setAssetPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = checkFields(formData, [
    { name: 'price', kind: 'amount' },
    { name: 'pricedOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  try {
    await setManualPrice(userId, str(formData, 'assetId'), num(formData, 'price'), str(formData, 'pricedOn'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

/** Forgetting an asset nothing happened on: a watchlist entry, no more. */
export async function stopFollowingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await stopFollowing(userId, str(formData, 'assetId'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}
