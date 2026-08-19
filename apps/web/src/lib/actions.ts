'use server'

import { auth } from '@abacus/core/auth'
import type { Judgment, PeriodUnit } from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import { closeAccount, createAccount } from '@abacus/core/services/accounts'
import { createActor, resolveActor } from '@abacus/core/services/actors'
import { recordBalanceCheck } from '@abacus/core/services/balanceChecks'
import { createActivity, createCategory } from '@abacus/core/services/catalog'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  setJudgment,
  skipNextOccurrence,
} from '@abacus/core/services/commitments'
import { closeAdvance, declareMovement } from '@abacus/core/services/movements'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export interface FormState {
  error?: string
  ok?: boolean
}

const FR: Record<string, string> = {
  account_closed: 'Ce compte est clos à cette date.',
  transfer_has_no_category: 'Un virement interne ne porte pas de catégorie.',
  not_an_advance: 'Le mouvement visé n’est pas une avance.',
  financing_settled: 'Ce financement est déjà soldé.',
  cancelled: 'Cet engagement est résilié.',
  already_cancelled: 'Cet engagement est déjà résilié.',
  no_gap: 'Ce pointage n’a aucun écart à solder.',
  actor_exists: 'Ce nom désigne déjà un acteur existant.',
  bad_source: 'Il manque le compte ou l’acteur source.',
  bad_target: 'Il manque le compte ou l’acteur destination.',
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

function num(formData: FormData, key: string): number {
  return Number(String(formData.get(key) ?? '').replace(',', '.'))
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

function refreshAll() {
  revalidatePath('/')
  revalidatePath('/mouvements')
  revalidatePath('/abonnements')
  revalidatePath('/comptes')
}

export async function declareMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const type = str(formData, 'type')
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
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function recordBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await recordBalanceCheck(userId, str(formData, 'accountId'), num(formData, 'balance'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
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

export async function closeAccountAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  await closeAccount(userId, str(formData, 'accountId'))
  refreshAll()
}

export async function createSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await createSubscription(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      direction: formData.get('incoming') ? 'incoming' : 'outgoing',
      amount: num(formData, 'amount'),
      periodUnit: str(formData, 'periodUnit') as PeriodUnit,
      periodCount: opt(formData, 'periodCount') ? num(formData, 'periodCount') : undefined,
      firstDueOn: str(formData, 'firstDueOn'),
      categoryId: opt(formData, 'categoryId'),
      judgment: opt(formData, 'judgment') as Judgment | undefined,
    })
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createFinancingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await createFinancing(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      installmentAmount: num(formData, 'installmentAmount'),
      installmentsTotal: num(formData, 'installmentsTotal'),
      firstDueOn: str(formData, 'firstDueOn'),
      totalAmount: opt(formData, 'totalAmount') ? num(formData, 'totalAmount') : undefined,
      categoryId: opt(formData, 'categoryId'),
    })
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
    })
  } catch (e) {
    redirect(`/abonnements?erreur=${encodeURIComponent(frError(e))}`)
  }
  refreshAll()
}

export async function skipOccurrenceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await skipNextOccurrence(userId, str(formData, 'commitmentId'))
  } catch (e) {
    redirect(`/abonnements?erreur=${encodeURIComponent(frError(e))}`)
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

export async function changePriceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await changeAmount(userId, str(formData, 'commitmentId'), num(formData, 'amount'))
  } catch (e) {
    redirect(`/abonnements?erreur=${encodeURIComponent(frError(e))}`)
  }
  refreshAll()
}

export async function cancelCommitmentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await cancelCommitment(userId, str(formData, 'commitmentId'))
  } catch (e) {
    redirect(`/abonnements?erreur=${encodeURIComponent(frError(e))}`)
  }
  refreshAll()
}

export async function closeAdvanceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  await closeAdvance(userId, str(formData, 'movementId'))
  refreshAll()
}

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await createCategory(userId, str(formData, 'name'), opt(formData, 'group'))
  } catch (e) {
    return { error: frError(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
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
  revalidatePath('/cles-api')
  return { ok: true, key: created.key }
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  await auth.api.deleteApiKey({
    body: { keyId: str(formData, 'keyId') },
    headers: await headers(),
  })
  revalidatePath('/cles-api')
}
