'use server'

import { auth } from '@abacus/core/auth'
import { revokeAuthorization } from '@abacus/core/authorizations'
import type {
  AccountBehavior,
  ActivityKind,
  AssetNature,
  DayShift,
  DebitMode,
  DeductibleExpenses,
  InstrumentKind,
  Judgment,
  LevyStatus,
  ModifierEffect,
  PeriodRef,
  PeriodUnit,
  RevenueBasis,
  ThresholdMeasure,
} from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import type { Answers } from '@abacus/core/domain/regime'
import { closeAccount, createAccount, editAccount, reopenAccount } from '@abacus/core/services/accounts'
import {
  confirmLevyPayment,
  confirmNilReturn,
  type DueDateInput,
  withdrawNilReturn,
} from '@abacus/core/services/activityStatement'
import {
  addAlias,
  countReattachableMovements,
  createActor,
  editActor,
  mergeActors,
  type ReattachableCount,
  reattachActorHistory,
  resolveActor,
} from '@abacus/core/services/actors'
import { closeShare, removeShare, setShareSchedule } from '@abacus/core/services/advances'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  recordBalanceCheck,
} from '@abacus/core/services/balanceChecks'
import {
  type CardInput,
  confirmStatement,
  createCard,
  deleteCard,
  editCard,
} from '@abacus/core/services/cards'
import {
  closeActivity,
  createActivity,
  createCategory,
  editActivity,
  editCategory,
  reopenActivity,
  setActivityCategoryExceptions,
} from '@abacus/core/services/catalog'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createInvestmentPlan,
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
  cancelInvoice,
  correctInvoice,
  declareInvoice,
  remindInvoice,
  settleInvoice,
} from '@abacus/core/services/invoices'
import {
  addModifier,
  closeLevy,
  createLevy,
  createThreshold,
  deleteLevy,
  editLevy,
  editThreshold,
  type NewLevy,
  removeInput,
  removeModifier,
  removeThreshold,
  setInput,
  supersedeLevy,
} from '@abacus/core/services/levies'
import {
  correctMovement,
  declareMovement,
  deleteMovement,
  refundShare,
} from '@abacus/core/services/movements'
import {
  setLanguagePreference,
  setRankingViewPreference,
  setReadingPreference,
} from '@abacus/core/services/preferences'
import {
  applyRegime,
  previewRegime,
  type QuestionnaireStep,
  questionnaire,
  type RegimePreview,
} from '@abacus/core/services/regimes'
import { revalidatePath } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { BROWSER_LANGUAGE, INTL_LOCALE, isLanguage } from '@/i18n/config'
import type { Messages } from '@/i18n/messages/fr'
import { parseReading, READING_COOKIE } from '@/lib/reading'

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

async function checkFields(formData: FormData, rules: FieldRule[]): Promise<Record<string, string> | null> {
  const n = await numbersOf(formData)
  const t = await getTranslations('actions.fields')
  const errors: Record<string, string> = {}
  for (const { name, kind = 'text' } of rules) {
    const raw = str(formData, name)
    if (raw === '') {
      errors[name] = t('required')
      continue
    }
    if (kind === 'amount') {
      const value = n.num(name)
      if (!Number.isFinite(value)) errors[name] = t('invalidAmount')
      else if (value <= 0) errors[name] = t('positive')
    }
    if (kind === 'count') {
      const value = n.num(name)
      if (!Number.isInteger(value) || value < 2) errors[name] = t('installmentCount')
    }
    if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors[name] = t('invalidDate')
  }
  return Object.keys(errors).length > 0 ? errors : null
}

/** The message of one field check written inline in an action rather than as a rule. */
async function fieldError(key: keyof Messages['actions']['fields']): Promise<string> {
  return (await getTranslations('actions.fields'))(key)
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

/**
 * What a refused gesture says to the person in front of the screen. The domain
 * throws a code and an English sentence for the log; the `errors` catalog turns
 * that code into a sentence in the language of the interface, once, for every
 * action of the app.
 *
 * A code with no sentence there falls back to the domain's own message, which
 * is readable but written for whoever reads the code: a gesture the interface
 * offers deserves a sentence written for its user, and a test holds that line.
 */
async function refusal(e: unknown): Promise<string> {
  const t = await getTranslations('errors')
  if (e instanceof DomainError) {
    const code = e.code as keyof Messages['errors']
    return t.has(code) ? t(code) : e.message
  }
  if ((e as { code?: string }).code === '23505') return t('duplicateName')
  throw e
}

/**
 * The numbers of a form, read in the language of the request. Amounts arrive
 * as a machine value ("2000.5") from AmountInput; the plain decimal fields send
 * what was typed, grouped and marked the way the language writes numbers
 * ("2 000,50" in French, "2,000.50" in English). The separators come from Intl,
 * so a language added later brings its own. Spaces are dropped whatever the
 * language, and a typed point still reads as a decimal mark where the language
 * marks decimals with a comma.
 */
interface Numbers {
  /** A number as typed or posted; NaN when it is not one. */
  parse(raw: string): number
  num(key: string): number
  /** An amount left empty is an absence, not a zero. */
  optNum(key: string): number | undefined
}

async function numbersOf(formData: FormData): Promise<Numbers> {
  const parts = new Intl.NumberFormat(INTL_LOCALE[await getLocale()]).formatToParts(1234.5)
  const group = parts.find((part) => part.type === 'group')?.value ?? ''
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.'
  const parse = (raw: string) => {
    const text = raw.replace(/[\s\u202f\u00a0]/g, '')
    return Number((group ? text.replaceAll(group, '') : text).replace(decimal, '.'))
  }
  const num = (key: string) => parse(String(formData.get(key) ?? ''))
  return { parse, num, optNum: (key) => (opt(formData, key) === undefined ? undefined : num(key)) }
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function opt(formData: FormData, key: string): string | undefined {
  const v = str(formData, key)
  return v === '' ? undefined : v
}

/** Optional percentages: empty is "not stated", anything else stays within 0 and 100. */
async function checkRates(formData: FormData, names: string[]): Promise<Record<string, string> | null> {
  const n = await numbersOf(formData)
  const t = await getTranslations('actions.fields')
  const errors: Record<string, string> = {}
  for (const name of names) {
    if (opt(formData, name) === undefined) continue
    const value = n.num(name)
    if (!(value >= 0 && value <= 100)) errors[name] = t('percentage')
  }
  return Object.keys(errors).length > 0 ? errors : null
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
 * The shares a panel states, one row each: who by name, the euros its share
 * fields settled on, and on a financing whether it is owed on the total. A
 * row left blank states nothing; one with an amount and no name is refused
 * like any share without its debtor. Undefined when the block was not
 * offered, an empty list when every row was removed: the service then drops
 * the shares there were.
 */
async function sharesOf(
  userId: string,
  formData: FormData,
  n: Awaited<ReturnType<typeof numbersOf>>,
): Promise<{ debtorActorId: string; amount: number; perOccurrence: boolean }[] | undefined> {
  if (formData.get('sharesField') === null) return undefined
  const amounts = formData.getAll('shareAmount').map(String)
  const totals = formData.getAll('shareOnTotal').map(String)
  const shares = []
  for (const [index, raw] of formData.getAll('shareDebtor').entries()) {
    const name = String(raw).trim()
    const amount = (amounts[index] ?? '').trim()
    if (!name && !amount) continue
    if (!name) throw new DomainError('advance_needs_actor', 'A share needs the actor who owes it')
    shares.push({
      debtorActorId: await actorIdFromName(userId, name),
      amount: amount ? n.parse(amount) : Number.NaN,
      perOccurrence: totals[index] !== '1',
    })
  }
  return shares
}

/**
 * What an income pays back, as the panel's choice encodes it: one claim, an
 * expense whose share of the sender it pays (created when they owed nothing
 * on it yet), or a commitment whose reserve it feeds. Empty: nothing.
 */
function refundTarget(value: string | undefined): {
  refundsShareId?: string
  refundsMovementId?: string
  reservesCommitmentId?: string
} {
  if (!value) return {}
  const [kind, id] = value.split(':')
  if (kind === 'claim') return { refundsShareId: id }
  if (kind === 'reserve') return { reservesCommitmentId: id }
  return { refundsMovementId: id }
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
    '/activity',
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
  redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`)
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
  const n = await numbersOf(formData)
  const type = str(formData, 'type')
  const invalid = await checkFields(formData, movementRules(type))
  if (invalid) return { fields: invalid }
  try {
    const accountId = str(formData, 'accountId')
    const actorName = opt(formData, 'actor')
    let endpoints: Record<string, string | undefined>
    if (type === 'transfer') {
      endpoints = { sourceAccountId: accountId, targetAccountId: opt(formData, 'toAccountId') }
    } else {
      if (!actorName) return { error: (await getTranslations('actions.movement'))('counterpartyMissing') }
      const actorId = await actorIdFromName(userId, actorName)
      endpoints =
        type === 'expense'
          ? { sourceAccountId: accountId, targetActorId: actorId }
          : { sourceActorId: actorId, targetAccountId: accountId }
    }
    const shares = type === 'expense' ? await sharesOf(userId, formData, n) : undefined
    const currency = opt(formData, 'currency')
    await declareMovement(userId, {
      happenedOn: str(formData, 'date'),
      amount: n.num('amount'),
      currency,
      eurAmount: currency && currency !== 'EUR' ? n.optNum('eurAmount') : undefined,
      ...endpoints,
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
      note: opt(formData, 'note'),
      accrualMonth: opt(formData, 'accrualMonth'),
      ghost: formData.get('ghost') !== null,
      ...(type === 'income' ? refundTarget(opt(formData, 'refundTarget')) : {}),
      invoiceId: opt(formData, 'invoiceId'),
      // Rendered only on an expense of an activity that reclaims VAT, so an
      // absent field is the truth everywhere else.
      vatAmount: n.optNum('vatAmount'),
      refundShares: shares?.length ? shares : undefined,
      refundedNow: shares?.length ? formData.get('refundedNow') !== null : undefined,
      refundedBy: type === 'expense' ? linkedIncomes(formData) : undefined,
      // No card chosen: the account was debited directly.
      cardId: type === 'transfer' ? undefined : opt(formData, 'cardId'),
    })
  } catch (e) {
    return { error: await refusal(e) }
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
  const n = await numbersOf(formData)
  const type = str(formData, 'type')
  const invalid = await checkFields(formData, movementRules(type))
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
      if (!actorName) return { error: (await getTranslations('actions.movement'))('counterpartyMissing') }
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
    // expense drops its shares rather than colliding with the domain rule.
    const shares = type === 'expense' ? await sharesOf(userId, formData, n) : null
    // The form rebuilds the money side whole, so the currency travels even as
    // 'EUR': that is what drops a wrongly declared foreign original.
    const currency = type === 'transfer' ? undefined : opt(formData, 'currency')
    await correctMovement(userId, str(formData, 'movementId'), {
      happenedOn: str(formData, 'date'),
      amount: n.num('amount'),
      currency,
      eurAmount: currency && currency !== 'EUR' ? n.optNum('eurAmount') : undefined,
      ...endpoints,
      categoryId: opt(formData, 'categoryId') ?? null,
      activityId: opt(formData, 'activityId') ?? null,
      note: opt(formData, 'note') ?? null,
      // The form rebuilds the movement whole, so a closed (or unrendered)
      // attachment block detaches it, the way it drops a claim.
      accrualMonth: opt(formData, 'accrualMonth') ?? null,
      // Same: an unchecked (or unrendered) box brings the movement back into
      // the analyses, which is what the panel shows.
      ghost: formData.get('ghost') !== null,
      refundShares: shares,
      refundedBy: type === 'expense' ? linkedIncomes(formData) : undefined,
      // Only where the panel offered the choice: an empty one unlinks.
      ...(type === 'income' && formData.get('refundTargetField') !== null
        ? {
            refundsShareId: null,
            refundsMovementId: null,
            reservesCommitmentId: null,
            ...refundTarget(opt(formData, 'refundTarget')),
          }
        : {}),
      // Same as the claim: an emptied (or unrendered) field clears the VAT
      // rather than keeping a figure the panel no longer shows.
      vatAmount: n.optNum('vatAmount') ?? null,
      // Same: no card chosen (or none offered) means debited directly.
      cardId: type === 'transfer' ? null : (opt(formData, 'cardId') ?? null),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** The incomes a panel links to the expense it declares or corrects. */
function linkedIncomes(formData: FormData): string[] | undefined {
  const ids = formData.getAll('refundedBy').map(String).filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

/**
 * Takes an income off the share it paid back, or off the reserve it fed: it
 * is a plain income again. Called directly by the link's own button, after its
 * confirmation.
 */
export async function unlinkRefundAction(movementId: string): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await correctMovement(userId, movementId, {
      refundsMovementId: null,
      refundsShareId: null,
      reservesCommitmentId: null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Drops a share by name; its refunds, if any, become plain incomes again. The
 * share's own button calls it, after a confirmation that says so.
 */
export async function removeShareAction(shareId: string): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await removeShare(userId, shareId)
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteMovement(userId, str(formData, 'movementId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function recordBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  // A real balance can legitimately be zero or negative, so only its shape is
  // checked here.
  const raw = str(formData, 'balance')
  if (raw === '') return { fields: { balance: await fieldError('required') } }
  if (!Number.isFinite(n.num('balance'))) return { fields: { balance: await fieldError('invalidAmount') } }
  try {
    await recordBalanceCheck(userId, str(formData, 'accountId'), n.num('balance'))
  } catch (e) {
    return { error: await refusal(e) }
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
  const n = await numbersOf(formData)
  const raw = str(formData, 'balance')
  if (raw === '') return { fields: { balance: await fieldError('required') } }
  if (!Number.isFinite(n.num('balance'))) return { fields: { balance: await fieldError('invalidAmount') } }
  const invalid = await checkFields(formData, [{ name: 'checkedOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await correctBalanceCheck(userId, str(formData, 'checkId'), {
      declaredBalance: n.num('balance'),
      checkedOn: str(formData, 'checkedOn'),
    })
  } catch (e) {
    return { error: await refusal(e) }
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
  const invalid = await checkFields(formData, [{ name: 'actor' }])
  if (invalid) return { fields: invalid }
  try {
    await createAdjustment(userId, str(formData, 'checkId'), {
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      categoryId: opt(formData, 'categoryId'),
      note: opt(formData, 'note'),
      ghost: formData.get('ghost') !== null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteBalanceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteBalanceCheck(userId, str(formData, 'checkId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createAccount({
      userId,
      name: str(formData, 'name'),
      behavior: str(formData, 'behavior') as 'payment' | 'savings' | 'investment',
      institution: opt(formData, 'institution') ?? null,
      openingBalance: n.optNum('openingBalance'),
      openedOn: opt(formData, 'openedOn') ?? null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * What an account says about itself, its opening included. What its movements
 * did to it is history, never edited here; the panel carries every field, so a
 * cleared opening means zero.
 */
export async function editAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editAccount(userId, str(formData, 'accountId'), {
      name: str(formData, 'name'),
      institution: opt(formData, 'institution') ?? null,
      behavior: str(formData, 'behavior') as AccountBehavior,
      openingBalance: n.optNum('openingBalance') ?? 0,
      openedOn: opt(formData, 'openedOn'),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function reopenAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await reopenAccount(userId, str(formData, 'accountId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function closeAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await closeAccount(userId, str(formData, 'accountId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * A card as the panel sends it: the schedule only travels with a deferred
 * card, since the service refuses one on an immediate card rather than
 * storing it and forgetting it.
 */
async function cardFields(
  formData: FormData,
): Promise<{ fields?: Record<string, string>; input?: CardInput }> {
  const n = await numbersOf(formData)
  const debitMode = (str(formData, 'debitMode') || 'immediate') as DebitMode
  const deferred = debitMode === 'deferred'
  const invalid = await checkFields(formData, [
    { name: 'name' },
    { name: 'accountId' },
    { name: 'expiryMonth' },
    ...(deferred ? [{ name: 'statementDay' }, { name: 'debitDay' }] : []),
  ])
  if (invalid) return { fields: invalid }
  return {
    input: {
      name: str(formData, 'name'),
      accountId: str(formData, 'accountId'),
      expiryMonth: str(formData, 'expiryMonth'),
      debitMode,
      ...(deferred && {
        statementDay: n.num('statementDay'),
        statementShift: (str(formData, 'statementShift') || 'none') as DayShift,
        debitDay: n.num('debitDay'),
        debitShift: (str(formData, 'debitShift') || 'none') as DayShift,
      }),
    },
  }
}

export async function createCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const { fields, input } = await cardFields(formData)
  if (fields) return { fields }
  try {
    await createCard(userId, input!)
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function editCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const { fields, input } = await cardFields(formData)
  if (fields) return { fields }
  try {
    await editCard(userId, str(formData, 'cardId'), input!)
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** The bank debited a statement: the day it did, which moves every purchase of the cycle onto it. */
export async function confirmStatementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'debitedOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await confirmStatement(userId, str(formData, 'statementId'), str(formData, 'debitedOn'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** A statement validated by mistake goes back to waiting, off the balances. */
export async function undoStatementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await confirmStatement(userId, str(formData, 'statementId'), null)
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteCard(userId, str(formData, 'cardId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createSubscriptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [
    { name: 'label' },
    { name: 'actor' },
    { name: 'accountId' },
    { name: 'amount', kind: 'amount' },
    { name: 'firstDueOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: await fieldError('required') } }
  try {
    await createSubscription(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      direction: str(formData, 'direction') === 'incoming' ? 'incoming' : 'outgoing',
      amount: n.num('amount'),
      currency: opt(formData, 'currency'),
      ...every,
      firstDueOn: str(formData, 'firstDueOn'),
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
      judgment: opt(formData, 'judgment') as Judgment | undefined,
      engagedUntil: opt(formData, 'engagedUntil'),
      cardId: str(formData, 'direction') === 'incoming' ? undefined : opt(formData, 'cardId'),
      refundShares: (await sharesOf(userId, formData, n))?.map(({ perOccurrence: _, ...share }) => share),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * A scheduled placement: the two accounts, what it buys, and how often. No
 * actor and no category, because what it produces is an internal transfer.
 */
export async function createInvestmentPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const rules: FieldRule[] = [
    { name: 'label' },
    { name: 'accountId' },
    { name: 'targetAccountId' },
    { name: 'amount', kind: 'amount' },
    { name: 'firstDueOn', kind: 'date' },
  ]
  // Looked up on the spot, the asset arrives as its instrument reference and is
  // declared by this submit, exactly as in the operation panel.
  if (opt(formData, 'reference') === undefined) rules.push({ name: 'assetId' })
  const invalid = await checkFields(formData, rules)
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: await fieldError('required') } }
  try {
    await createInvestmentPlan(userId, {
      label: str(formData, 'label'),
      accountId: str(formData, 'accountId'),
      targetAccountId: str(formData, 'targetAccountId'),
      assetId: (await assetIdFrom(userId, formData))!,
      amount: n.num('amount'),
      ...every,
      firstDueOn: str(formData, 'firstDueOn'),
      activityId: opt(formData, 'activityId'),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The schedule as edited line by line, or undefined when the editor was left
 * closed. Dates and amounts arrive as parallel lists in contractual order,
 * which is the order the rows were rendered in.
 */
function scheduleFrom(formData: FormData, n: Numbers): { dueOn: string; amount: number }[] | undefined {
  const dates = formData.getAll('installmentDueOn').map(String)
  const amounts = formData.getAll('installmentAmount').map(String)
  if (dates.length === 0 || dates.length !== amounts.length) return undefined
  return dates.map((dueOn, index) => ({
    dueOn,
    amount: n.parse(amounts[index]!),
  }))
}

export async function createFinancingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [
    { name: 'label' },
    { name: 'actor' },
    { name: 'accountId' },
    { name: 'totalAmount', kind: 'amount' },
    { name: 'installmentsTotal', kind: 'count' },
    { name: 'firstDueOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: await fieldError('required') } }
  try {
    await createFinancing(userId, {
      label: str(formData, 'label'),
      actorId: await actorIdFromName(userId, str(formData, 'actor')),
      accountId: str(formData, 'accountId'),
      totalAmount: n.num('totalAmount'),
      installmentsTotal: n.num('installmentsTotal'),
      currency: opt(formData, 'currency'),
      firstDueOn: str(formData, 'firstDueOn'),
      ...every,
      // Present only when the schedule editor was opened; otherwise the plan
      // is generated from the total.
      installments: scheduleFrom(formData, n),
      categoryId: opt(formData, 'categoryId'),
      activityId: opt(formData, 'activityId'),
      cardId: opt(formData, 'cardId'),
      refundShares: await sharesOf(userId, formData, n),
    })
  } catch (e) {
    return { error: await refusal(e) }
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
  const n = await numbersOf(formData)
  const ids = formData.getAll('installmentId').map(String)
  const lines = scheduleFrom(formData, n)
  if (!lines) return { error: (await getTranslations('errors'))('schedule_empty') }
  if (lines.some((line) => !/^\d{4}-\d{2}-\d{2}$/.test(line.dueOn) || !(line.amount > 0)))
    return { error: (await getTranslations('actions.schedule'))('installmentIncomplete') }
  try {
    await reviseSchedule(
      userId,
      str(formData, 'commitmentId'),
      lines.map((line, index) => ({ id: ids[index] || undefined, ...line })),
    )
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function confirmOccurrenceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  try {
    await confirmNextOccurrence(userId, str(formData, 'commitmentId'), {
      amount: opt(formData, 'amount') ? n.num('amount') : undefined,
      happenedOn: opt(formData, 'date'),
      // "It is the new normal": historises the change instead of treating it
      // as a one-off month.
      updateReference: formData.get('newAmount') !== null,
      eurAmount: n.optNum('eurAmount'),
      // A placement also buys: the quantity is required there, and the amount
      // invested only differs when the broker left a remainder in cash.
      quantity: n.optNum('quantity'),
      investedAmount: n.optNum('investedAmount'),
    })
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

export async function skipOccurrenceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await skipNextOccurrence(userId, str(formData, 'commitmentId'))
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

/**
 * Judges a subscription. Called straight from the row rather than through a
 * form: the judgment travels as an argument, so there is no empty field to
 * swallow, and a refusal comes back to the row that asked for it.
 */
export async function setJudgmentAction(commitmentId: string, judgment: Judgment): Promise<string | null> {
  const userId = await requireUserId()
  try {
    await setJudgment(userId, commitmentId, judgment)
  } catch (e) {
    return refusal(e)
  }
  refreshAll()
  return null
}

/**
 * Corrects what a commitment says about itself. Neither the amount nor the
 * account is here: both are dated histories with their own gesture, and a
 * financing's amount comes from its schedule.
 */
export async function editCommitmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  // A placement pays nobody, so its panel shows no actor and asks for what it
  // buys instead: the two shapes are validated for what they each carry.
  const placement = formData.get('placement') !== null
  const invalid = await checkFields(
    formData,
    placement
      ? [{ name: 'label' }, { name: 'targetAccountId' }, { name: 'assetId' }]
      : [{ name: 'label' }, { name: 'actor' }],
  )
  if (invalid) return { fields: invalid }
  const every = period(formData)
  if (!every) return { fields: { period: await fieldError('required') } }
  try {
    await editCommitment(userId, str(formData, 'commitmentId'), {
      label: str(formData, 'label'),
      ...(placement
        ? {
            targetAccountId: str(formData, 'targetAccountId'),
            assetId: str(formData, 'assetId'),
          }
        : {
            actorId: await actorIdFromName(userId, str(formData, 'actor')),
            categoryId: opt(formData, 'categoryId') ?? null,
            // Financings never carry one, and the panel does not show the field
            // for them: an empty value clears it rather than being refused.
            engagedUntil: opt(formData, 'engagedUntil') ?? null,
          }),
      activityId: opt(formData, 'activityId') ?? null,
      ...every,
      // Only where the panel offered one: an empty choice then means a direct debit.
      ...(formData.get('cardField') !== null && { cardId: opt(formData, 'cardId') ?? null }),
      // Only where the panel offered them: every row removed drops the shares.
      refundShares: await sharesOf(userId, formData, await numbersOf(formData)),
    })
  } catch (e) {
    return { error: await refusal(e) }
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
  const invalid = await checkFields(formData, [{ name: 'accountId' }, { name: 'effectiveOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await moveAccount(
      userId,
      str(formData, 'commitmentId'),
      str(formData, 'accountId'),
      str(formData, 'effectiveOn'),
    )
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function changePriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [{ name: 'amount', kind: 'amount' }])
  if (invalid) return { fields: invalid }
  try {
    await changeAmount(userId, str(formData, 'commitmentId'), n.num('amount'), undefined, {
      currency: opt(formData, 'currency'),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function cancelCommitmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await cancelCommitment(userId, str(formData, 'commitmentId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * "It came back": writes the income that pays a claim back. The amount is
 * editable on the way, because a refund arrives partial as often as whole.
 */
export async function refundShareAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  try {
    await refundShare(userId, str(formData, 'shareId'), {
      amount: opt(formData, 'amount') ? n.num('amount') : undefined,
      on: opt(formData, 'date'),
    })
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

export async function closeShareAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await closeShare(userId, str(formData, 'shareId'))
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

/**
 * When a debtor said they would pay a claim back: a count of equal payments a
 * period apart, or the lines adjusted one by one. `drop` forgets the plan.
 */
export async function planShareAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const shareId = str(formData, 'shareId')
  try {
    if (formData.get('drop') !== null) await setShareSchedule(userId, shareId, null)
    else {
      const invalid = await checkFields(formData, [
        { name: 'installmentsTotal', kind: 'count' },
        { name: 'firstDueOn', kind: 'date' },
      ])
      if (invalid) return { fields: invalid }
      const every = period(formData)
      if (!every) return { fields: { period: await fieldError('required') } }
      const lines = scheduleFrom(formData, n)
      await setShareSchedule(
        userId,
        shareId,
        lines
          ? { lines }
          : { count: n.num('installmentsTotal'), firstDueOn: str(formData, 'firstDueOn'), ...every },
      )
    }
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** What an invoice needs to exist; the rates and their amounts are optional, the service fills them. */
const INVOICE_RULES: FieldRule[] = [
  { name: 'client' },
  { name: 'issuedOn', kind: 'date' },
  { name: 'baseAmount', kind: 'amount' },
]

/**
 * The figures as the panel sends them: a rate and its amount both, whichever
 * was typed, because an amount given is the truth and the rate only proposes.
 */
function invoiceFigures(formData: FormData, n: Numbers) {
  return {
    reference: opt(formData, 'reference'),
    issuedOn: str(formData, 'issuedOn'),
    dueOn: opt(formData, 'dueOn'),
    baseAmount: n.num('baseAmount'),
    vatRate: n.optNum('vatRate'),
    vatAmount: n.optNum('vatAmount'),
    withholdingRate: n.optNum('withholdingRate'),
    withholdingAmount: n.optNum('withholdingAmount'),
    note: opt(formData, 'note'),
  }
}

export async function declareInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [{ name: 'activityId' }, ...INVOICE_RULES])
  if (invalid) return { fields: invalid }
  try {
    await declareInvoice(userId, {
      activityId: str(formData, 'activityId'),
      actorId: await actorIdFromName(userId, str(formData, 'client')),
      ...invoiceFigures(formData, n),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** Same panel as the declaration, so the invoice is rebuilt whole: an emptied field clears. */
export async function correctInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, INVOICE_RULES)
  if (invalid) return { fields: invalid }
  try {
    const figures = invoiceFigures(formData, n)
    await correctInvoice(userId, str(formData, 'invoiceId'), {
      ...figures,
      actorId: await actorIdFromName(userId, str(formData, 'client')),
      reference: figures.reference ?? null,
      dueOn: figures.dueOn ?? null,
      note: figures.note ?? null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * "The client paid": writes the income that pays the invoice, onto the chosen
 * account. The amount is editable on the way, because a payment arrives
 * partial as often as whole.
 */
export async function settleInvoiceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  try {
    await settleInvoice(userId, str(formData, 'invoiceId'), {
      amount: n.optNum('amount'),
      date: opt(formData, 'date'),
      accountId: str(formData, 'accountId'),
    })
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

export async function remindInvoiceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  try {
    await remindInvoice(userId, str(formData, 'invoiceId'))
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

/** The due date a row of the schedule names, as the service takes it. */
function dueDateOf(formData: FormData, n: Numbers): DueDateInput {
  return {
    levyId: str(formData, 'levyId'),
    periodStart: str(formData, 'periodStart'),
    entry: str(formData, 'entry') === 'regularization' ? 'regularization' : 'period',
    instalment: n.num('instalment') || undefined,
  }
}

/**
 * "Déclarée à 0": the return of a period with nothing in it was filed at zero,
 * which is what answers it, no payment of zero being possible.
 */
export async function confirmNilReturnAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  try {
    await confirmNilReturn(userId, dueDateOf(formData, n))
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

/** Takes back a return said filed at zero by mistake: the period is owed again. */
export async function withdrawNilReturnAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  try {
    await withdrawNilReturn(userId, dueDateOf(formData, n))
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

/**
 * "Payé": records what really left against one due date of a rule, which is
 * what makes its reserve fall. The amount is editable like a commitment's,
 * because an assessment differing from the estimate is the normal case and the
 * gap is worth seeing rather than smoothing over.
 */
export async function confirmLevyPaymentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const actor = str(formData, 'actor')
  if (actor === '') errorRedirect(formData, (await getTranslations('actions.levy'))('payeeMissing'))
  try {
    await confirmLevyPayment(userId, {
      ...dueDateOf(formData, n),
      amount: n.num('amount'),
      date: str(formData, 'date'),
      accountId: str(formData, 'accountId'),
      actorId: await actorIdFromName(userId, actor),
    })
  } catch (e) {
    errorRedirect(formData, await refusal(e))
  }
  refreshAll()
}

export async function cancelInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await cancelInvoice(userId, str(formData, 'invoiceId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createCategory(userId, str(formData, 'name'), opt(formData, 'group'))
  } catch (e) {
    return { error: await refusal(e) }
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
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editCategory(userId, str(formData, 'categoryId'), {
      name: str(formData, 'name'),
      groupLabel: opt(formData, 'group') ?? null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The regime of an activity, as the panel states it. A personal activity sends
 * its kind alone and everything else falls back to the defaults, which are what
 * "no regime" is; a business one sends every field, so what is not filled is
 * cleared, not kept.
 */
function activitySettings(formData: FormData, n: Numbers) {
  const vatRegistered = formData.get('vatRegistered') !== null
  const kind = str(formData, 'kind') as ActivityKind
  return {
    kind,
    // The panel only asks a business one what it lives on, and a checklist
    // sent whole means an empty one detaches everything.
    accountIds: kind === 'business' ? formData.getAll('accountIds').map(String) : undefined,
    startedOn: opt(formData, 'startedOn') ?? null,
    fiscalYearStartMonth: n.optNum('fiscalYearStartMonth'),
    fiscalYearStartDay: n.optNum('fiscalYearStartDay'),
    revenueBasis: opt(formData, 'revenueBasis') as RevenueBasis | undefined,
    vatRegistered,
    defaultVatRate: vatRegistered ? (n.optNum('defaultVatRate') ?? null) : null,
    deductibleExpenses: opt(formData, 'deductibleExpenses') as DeductibleExpenses | undefined,
    regimeLabel: opt(formData, 'regimeLabel') ?? null,
    jurisdiction: opt(formData, 'jurisdiction') ?? null,
    currency: opt(formData, 'currency'),
  }
}

async function activityInvalid(formData: FormData): Promise<Record<string, string> | null> {
  const n = await numbersOf(formData)
  const errors = {
    ...(await checkFields(formData, [{ name: 'name' }])),
    ...(await checkRates(formData, ['defaultVatRate'])),
  }
  const day = n.optNum('fiscalYearStartDay')
  if (day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 31))
    errors.fiscalYearStartDay = await fieldError('dayOfMonth')
  return Object.keys(errors).length > 0 ? errors : null
}

export async function createActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await activityInvalid(formData)
  if (invalid) return { fields: invalid }
  try {
    const activity = await createActivity(userId, {
      name: str(formData, 'name'),
      ...activitySettings(formData, n),
    })
    const exceptions = formData.getAll('exceptionCategoryIds').map(String)
    if (exceptions.length > 0) await setActivityCategoryExceptions(userId, activity.id, exceptions)
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function editActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await activityInvalid(formData)
  if (invalid) return { fields: invalid }
  try {
    await editActivity(userId, str(formData, 'activityId'), {
      name: str(formData, 'name'),
      ...activitySettings(formData, n),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function closeActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'closedOn', kind: 'date' }])
  if (invalid) return { fields: invalid }
  try {
    await closeActivity(userId, str(formData, 'activityId'), str(formData, 'closedOn'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function reopenActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await reopenActivity(userId, str(formData, 'activityId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** The whole list at once: what is unchecked is dropped, which is what a checklist says. */
export async function setActivityExceptionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await setActivityCategoryExceptions(
      userId,
      str(formData, 'activityId'),
      formData.getAll('exceptionCategoryIds').map(String),
    )
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The guided creation of a business activity: the catalog walks the tree, the
 * screen only puts the questions. Reading the catalog costs no query, but it
 * still goes through an action: the models live in the server bundle, and the
 * walk has to stay the one the MCP takes, not a second one written for a form.
 */
export async function regimeStepAction(
  jurisdictionId: string,
  answers: Answers,
): Promise<{ step?: QuestionnaireStep; error?: string }> {
  await requireUserId()
  try {
    return { step: questionnaire(jurisdictionId, answers) }
  } catch (e) {
    return { error: await refusal(e) }
  }
}

/** What a model would write, before anything is written. */
export async function regimePreviewAction(
  modelId: string,
  answers: Answers,
): Promise<{ preview?: RegimePreview; error?: string }> {
  await requireUserId()
  try {
    return { preview: previewRegime(modelId, answers) }
  } catch (e) {
    return { error: await refusal(e) }
  }
}

/**
 * The answers travel one field each, named after their question, so nothing
 * has to be parsed back out of a blob and a stray field cannot pass for one.
 */
const ANSWER_PREFIX = 'answer.'

function answersFrom(formData: FormData): Answers {
  const answers: Answers = {}
  for (const [key, value] of formData.entries())
    if (key.startsWith(ANSWER_PREFIX)) answers[key.slice(ANSWER_PREFIX.length)] = String(value)
  return answers
}

/**
 * Creates the activity and the rules the model holds, in one transaction. From
 * here they belong to the user: the catalog will never reach them again.
 */
export async function createActivityFromRegimeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await applyRegime(userId, {
      name: str(formData, 'name'),
      modelId: str(formData, 'modelId'),
      answers: answersFrom(formData),
      startedOn: opt(formData, 'startedOn') ?? null,
      accountIds: formData.getAll('accountIds').map(String),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Corrects an actor. The former name is replaced, not kept as an alias: a typo
 * has to stop resolving. A name that really was in use gets added as an alias
 * instead, deliberately.
 */
export interface ActorFormState extends FormState {
  /** Past movements a changed activity did not touch, for the form to point at the gesture that does. */
  leftBehind?: number
}

export async function editActorAction(_prev: ActorFormState, formData: FormData): Promise<ActorFormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = {
    ...(await checkFields(formData, [{ name: 'name' }])),
    ...(await checkRates(formData, ['invoiceVatRate', 'invoiceWithholdingRate'])),
  }
  if (Object.keys(invalid).length > 0) return { fields: invalid }
  let leftBehind: number
  try {
    ;({ leftBehind } = await editActor(userId, str(formData, 'actorId'), {
      name: str(formData, 'name'),
      activityId: opt(formData, 'activityId') ?? null,
      note: opt(formData, 'note') ?? null,
      invoiceVatRate: n.optNum('invoiceVatRate') ?? null,
      invoiceWithholdingRate: n.optNum('invoiceWithholdingRate') ?? null,
    }))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true, leftBehind }
}

/** What the reattach confirmation announces, refreshed as its scope changes. */
export async function countReattachableAction(
  actorId: string,
  from: string | undefined,
  previousActivityId: string | null,
): Promise<ReattachableCount> {
  const userId = await requireUserId()
  try {
    return await countReattachableMovements(userId, actorId, { from, previousActivityId })
  } catch (e) {
    // An actor that vanished meanwhile has nothing to reattach, and the
    // gesture behind this count says so itself if it is still attempted.
    if (e instanceof DomainError) return { count: 0, since: null }
    throw e
  }
}

/**
 * The explicit gesture that reclassifies an actor's history onto its
 * activity; the service says what it takes and what it leaves.
 */
export async function reattachActorHistoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await reattachActorHistory(userId, str(formData, 'actorId'), {
      from: opt(formData, 'from'),
      previousActivityId: opt(formData, 'previousActivityId') ?? null,
    })
  } catch (e) {
    return { error: await refusal(e) }
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
  const invalid = await checkFields(formData, [{ name: 'alias' }])
  if (invalid) return { fields: invalid }
  try {
    await addAlias(userId, str(formData, 'actorId'), str(formData, 'alias'))
  } catch (e) {
    return { error: await refusal(e) }
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
  const invalid = await checkFields(formData, [{ name: 'keepId' }])
  if (invalid) return { fields: invalid }
  try {
    await mergeActors(userId, str(formData, 'keepId'), str(formData, 'actorId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function createActorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await createActor(userId, { name: str(formData, 'name') })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * Settles the reading every page load starts from. This is the only gesture
 * that writes it, and it drops whatever a screen was switched to along the
 * way: naming the way you count is not asking to keep reading the other way
 * for the rest of the visit.
 */
export async function setReadingPreferenceAction(reading: string): Promise<string | null> {
  const userId = await requireUserId()
  const value = parseReading(reading)
  if (!value) return (await getTranslations('actions.preferences'))('unknownReading')
  try {
    await setReadingPreference(userId, value)
  } catch (e) {
    return refusal(e)
  }
  ;(await cookies()).delete(READING_COOKIE)
  refreshAll()
  return null
}

/** Settles how the Analyse screen draws its ranking. A display only: no figure moves. */
export async function setRankingViewPreferenceAction(view: string): Promise<string | null> {
  const userId = await requireUserId()
  if (view !== 'strip' && view !== 'bars')
    return (await getTranslations('actions.preferences'))('unknownRankingView')
  try {
    await setRankingViewPreference(userId, view)
  } catch (e) {
    return refusal(e)
  }
  revalidatePath('/analysis')
  revalidatePath('/settings')
  return null
}

/**
 * Settles the language the interface speaks, or hands it back to the browser.
 * Every screen is rewritten in it, so the whole tree is revalidated.
 */
export async function setLanguagePreferenceAction(language: string): Promise<string | null> {
  const userId = await requireUserId()
  if (language !== BROWSER_LANGUAGE && !isLanguage(language))
    return (await getTranslations('actions.preferences'))('unknownLanguage')
  try {
    await setLanguagePreference(userId, language === BROWSER_LANGUAGE ? null : language)
  } catch (e) {
    return refusal(e)
  }
  revalidatePath('/', 'layout')
  return null
}

export async function revokeAuthorizationAction(formData: FormData): Promise<void> {
  await revokeAuthorization(await requireUserId(), str(formData, 'consentId'), await headers())
  revalidatePath('/connect-ai')
}

/**
 * What the user holds. A listed asset names where its price comes from and is
 * typed by it; without a source, its nature is the one thing only the holder
 * can say, so it is asked for instead.
 */
export async function declareAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const source = opt(formData, 'source')
  const invalid = await checkFields(
    formData,
    source ? [{ name: 'name' }, { name: 'reference' }] : [{ name: 'name' }, { name: 'nature' }],
  )
  if (invalid) return { fields: invalid }
  try {
    await declareAsset(userId, {
      name: str(formData, 'name'),
      instrument: source
        ? {
            kind: str(formData, 'kind') as InstrumentKind,
            priceSource: source as 'yahoo' | 'coingecko',
            priceSourceRef: str(formData, 'reference'),
            name: opt(formData, 'description') ?? str(formData, 'name'),
          }
        : undefined,
      nature: source ? undefined : (str(formData, 'nature') as AssetNature),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function renameAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'name' }])
  if (invalid) return { fields: invalid }
  try {
    await editAsset(userId, str(formData, 'assetId'), str(formData, 'name'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The asset a panel is about: the one that was picked from what is already
 * known, or the instrument looked up on the spot, declared here. Shared by the
 * operation panel and the scheduled placement, which ask it the same way.
 *
 * Declaring is idempotent, so a rejected submit can be corrected and sent again
 * without tripping over the asset it already created.
 */
async function assetIdFrom(userId: string, formData: FormData): Promise<string | undefined> {
  const reference = opt(formData, 'reference')
  if (!reference) return opt(formData, 'assetId')
  const asset = await declareAsset(userId, {
    name: str(formData, 'assetName'),
    instrument: {
      kind: str(formData, 'kind') as InstrumentKind,
      priceSource: str(formData, 'source') as 'yahoo' | 'coingecko',
      priceSourceRef: reference,
      name: opt(formData, 'description') ?? str(formData, 'assetName'),
      isin: opt(formData, 'isin') ?? null,
    },
  })
  return asset.id
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
  const n = await numbersOf(formData)
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
  // An asset looked up on the spot arrives as its instrument reference; a known
  // one as its id. Either satisfies "this operation is about an asset".
  if (type !== 'fee' && opt(formData, 'reference') === undefined) rules.push({ name: 'assetId' })
  const invalid = await checkFields(formData, rules)
  if (invalid) return { fields: invalid }
  const quantity = trade ? n.num('quantity') : undefined

  let assetId: string | undefined
  try {
    assetId = await assetIdFrom(userId, formData)
  } catch (e) {
    return { error: await refusal(e) }
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
        amount: unitPriced ? undefined : n.num('amount'),
        unitPrice: unitPriced ? n.num('unitPrice') : undefined,
        operatedOn: str(formData, 'operatedOn'),
        note: opt(formData, 'note'),
      },
    ])
  } catch (e) {
    return { error: await refusal(e) }
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
  const n = await numbersOf(formData)
  const trade = str(formData, 'trade') === 'true'
  const rules: FieldRule[] = [
    { name: 'operatedOn', kind: 'date' },
    { name: 'amount', kind: 'amount' },
  ]
  if (trade) rules.push({ name: 'quantity', kind: 'amount' })
  const invalid = await checkFields(formData, rules)
  if (invalid) return { fields: invalid }
  try {
    await correctOperation(userId, str(formData, 'operationId'), {
      accountId: opt(formData, 'accountId'),
      quantity: trade ? n.num('quantity') : undefined,
      amount: n.num('amount'),
      operatedOn: str(formData, 'operatedOn'),
      note: opt(formData, 'note') ?? null,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

export async function deleteOperationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  try {
    await deleteOperation(userId, str(formData, 'operationId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/** A price for what no source quotes: an SCPI revalued, a flat reappraised. */
export async function setAssetPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [
    { name: 'price', kind: 'amount' },
    { name: 'pricedOn', kind: 'date' },
  ])
  if (invalid) return { fields: invalid }
  try {
    await setManualPrice(userId, str(formData, 'assetId'), n.num('price'), str(formData, 'pricedOn'))
  } catch (e) {
    return { error: await refusal(e) }
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
    return { error: await refusal(e) }
  }
  refreshAll()
  return { ok: true }
}

/**
 * The rules of an activity, its stated figures and its watched thresholds.
 * Everything below only reshapes a form into what the service takes: what a
 * rule guarantees and refuses is decided there, and both interfaces read it
 * at the same place.
 */

/** A repeated field, as a row-per-index list (the tables edited line by line). */
function list(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((v) => String(v).trim())
}

/** A cell of a table: empty means "no bound", never zero. */
function cell(n: Numbers, raw: string): number | null {
  if (raw === '') return null
  return n.parse(raw)
}

function rows<T>(
  formData: FormData,
  n: Numbers,
  keys: string[],
  build: (values: (number | null)[], index: number) => T,
): T[] {
  const columns = keys.map((key) => list(formData, key))
  const height = Math.max(...columns.map((c) => c.length))
  return Array.from({ length: height }, (_, index) =>
    build(
      columns.map((column) => cell(n, column[index] ?? '')),
      index,
    ),
  )
}

function abatementFrom(formData: FormData, n: Numbers): unknown {
  const mode = str(formData, 'abatementMode')
  if (mode === 'rate') return { rate: n.num('abatementRate'), minAmount: n.optNum('abatementMinAmount') }
  if (mode === 'brackets')
    return {
      brackets: rows(formData, n, ['abatementUpTo', 'abatementBracketRate'], ([upTo, rate]) => ({
        upTo,
        rate: rate ?? 0,
      })),
      on: { measure: str(formData, 'abatementMeasure'), periodRef: str(formData, 'abatementPeriodRef') },
    }
  return null
}

function creditsFrom(formData: FormData, n: Numbers): unknown {
  const sources = list(formData, 'creditSource')
  const levies = list(formData, 'creditLevyId')
  const shares = list(formData, 'creditShare')
  const refs = list(formData, 'creditPeriodRef')
  const credits = sources
    .map((source, index) => ({
      source,
      levyId: levies[index] || undefined,
      share: cell(n, shares[index] ?? '') ?? undefined,
      periodRef: refs[index] || undefined,
    }))
    .filter((credit) => credit.source !== '')
  return credits.length > 0 ? credits : null
}

function dueFrom(formData: FormData, n: Numbers): unknown {
  const type = str(formData, 'dueType')
  if (type === 'fixed_dates')
    return {
      type,
      dates: rows(
        formData,
        n,
        ['dueDateMonth', 'dueDateDay', 'dueDateYearOffset'],
        ([month, day, yearOffset]) => ({ month: month ?? 0, day: day ?? 0, yearOffset: yearOffset ?? 0 }),
      ),
    }
  if (type === 'after_period')
    return {
      type,
      monthOffset: n.optNum('dueMonthOffset'),
      fromDay: n.optNum('dueFromDay'),
      toDay: n.num('dueToDay'),
    }
  return { type: 'end_of_next_month' }
}

/** Periods folded into another return, named by the index of the rule's period. */
function skipPeriodsFrom(formData: FormData): unknown {
  const indexes = list(formData, 'skipPeriod')
    .map(Number)
    .filter((n) => Number.isInteger(n))
  if (indexes.length === 0) return null
  const period = str(formData, 'period')
  if (period === 'year') return null
  return { [period]: indexes }
}

function levyFrom(formData: FormData, n: Numbers): Omit<NewLevy, 'activityId'> {
  const amountForm = str(formData, 'amountForm') as NewLevy['amountForm']
  const regularization = (opt(formData, 'regularization') ?? 'none') as NewLevy['regularization']
  return {
    name: str(formData, 'name'),
    kind: str(formData, 'kind') as NewLevy['kind'],
    validFrom: str(formData, 'validFrom'),
    validTo: opt(formData, 'validTo') ?? null,
    sourceUrl: opt(formData, 'sourceUrl') ?? null,
    verifiedOn: opt(formData, 'verifiedOn') ?? null,
    reviewOn: opt(formData, 'reviewOn') ?? null,
    // A block the form did not render sends nothing, and an empty string is
    // not a value: the service then applies the column's own default.
    status: opt(formData, 'status') as NewLevy['status'],
    baseMeasure: str(formData, 'baseMeasure') as NewLevy['baseMeasure'],
    baseLevyId: opt(formData, 'baseLevyId') ?? null,
    baseInputName: opt(formData, 'baseInputName') ?? null,
    basePeriodRef: opt(formData, 'basePeriodRef') as NewLevy['basePeriodRef'],
    baseCoefficient: n.optNum('baseCoefficient') ?? null,
    baseAbatement: abatementFrom(formData, n),
    baseAddBackLevyIds: list(formData, 'addBackLevyId').filter(Boolean),
    baseFloor: n.optNum('baseFloor') ?? null,
    baseCap: n.optNum('baseCap') ?? null,
    baseCredits: creditsFrom(formData, n),
    baseScale: opt(formData, 'baseScale') as NewLevy['baseScale'],
    amountForm,
    rate: amountForm === 'rate' ? n.num('rate') : null,
    brackets:
      amountForm === 'brackets'
        ? {
            mode: str(formData, 'bracketsMode'),
            rows: rows(
              formData,
              n,
              ['bracketUpTo', 'bracketRate', 'bracketAmount'],
              ([upTo, rate, amount]) => ({
                upTo,
                rate: rate ?? undefined,
                amount: amount ?? undefined,
              }),
            ),
          }
        : null,
    elective:
      amountForm === 'elective_base'
        ? {
            rows: rows(
              formData,
              n,
              ['electiveUpTo', 'electiveMinBase', 'electiveMaxBase'],
              ([upTo, minBase, maxBase]) => ({ upTo, minBase: minBase ?? 0, maxBase: maxBase ?? 0 }),
            ),
            inputName: str(formData, 'electiveInputName'),
            rate: n.num('electiveRate'),
          }
        : null,
    fixedAmount: amountForm === 'fixed' ? (n.optNum('fixedAmount') ?? null) : null,
    fixedInputName: amountForm === 'fixed' ? (opt(formData, 'fixedInputName') ?? null) : null,
    fixedCredit: n.optNum('fixedCredit') ?? null,
    creditInputName: opt(formData, 'creditInputName') ?? null,
    period: str(formData, 'period') as NewLevy['period'],
    due: dueFrom(formData, n),
    declarationLagMonths: n.optNum('declarationLagMonths') ?? null,
    firstDueAfterDays: n.optNum('firstDueAfterDays') ?? null,
    skipPeriods: skipPeriodsFrom(formData),
    regularization,
    regularizationParams:
      regularization === 'none'
        ? null
        : {
            settleMonthOffset: n.optNum('settleMonthOffset'),
            refundMonthOffset: n.optNum('refundMonthOffset'),
          },
    settlementCategoryId: opt(formData, 'settlementCategoryId') ?? null,
    deductible: formData.get('deductible') !== null,
    passThrough: formData.get('passThrough') !== null,
    note: opt(formData, 'note') ?? null,
  }
}

/** What a rule cannot do without, whichever form it takes. */
function levyRules(formData: FormData): FieldRule[] {
  const rules: FieldRule[] = [
    { name: 'name' },
    { name: 'kind' },
    { name: 'validFrom', kind: 'date' },
    { name: 'baseMeasure' },
    { name: 'amountForm' },
    { name: 'period' },
    { name: 'dueType' },
  ]
  const form = str(formData, 'amountForm')
  if (form === 'rate') rules.push({ name: 'rate' })
  if (form === 'elective_base') rules.push({ name: 'electiveInputName' }, { name: 'electiveRate' })
  if (str(formData, 'baseMeasure') === 'input') rules.push({ name: 'baseInputName' })
  if (str(formData, 'dueType') === 'after_period') rules.push({ name: 'dueToDay' })
  return rules
}

/** The page of the activity whose rules just changed. */
function refreshActivity(activityId: string) {
  revalidatePath(`/settings/activities/${activityId}`)
  refreshAll()
}

export async function createLevyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, levyRules(formData))
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await createLevy(userId, { ...levyFrom(formData, n), activityId })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

/** Corrects a rule that was mistyped. A value that changed is a supersede. */
export async function editLevyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, levyRules(formData))
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await editLevy(userId, str(formData, 'levyId'), levyFrom(formData, n))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

/**
 * The rule changes from a date: the current row closes the day before and the
 * new one starts. The form carries every field, prefilled with what the rule
 * says today, so what did not change is simply carried over.
 */
export async function supersedeLevyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, levyRules(formData))
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    const { validFrom, ...changes } = levyFrom(formData, n)
    await supersedeLevy(userId, str(formData, 'levyId'), { ...changes, validFrom })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function closeLevyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const invalid = await checkFields(formData, [{ name: 'validTo', kind: 'date' }])
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await closeLevy(userId, str(formData, 'levyId'), str(formData, 'validTo'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function deleteLevyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const activityId = str(formData, 'activityId')
  try {
    await deleteLevy(userId, str(formData, 'levyId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function addModifierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [{ name: 'label' }, { name: 'effect' }])
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  const duration = str(formData, 'durationKind')
  try {
    await addModifier(userId, str(formData, 'levyId'), {
      label: str(formData, 'label'),
      effect: str(formData, 'effect') as ModifierEffect,
      value: n.optNum('value'),
      startsOn: opt(formData, 'startsOn'),
      durationMonths: duration === 'months' ? n.optNum('durationValue') : undefined,
      durationPeriods: duration === 'periods' ? n.optNum('durationValue') : undefined,
      endsOn: duration === 'endsOn' ? opt(formData, 'endsOn') : undefined,
      condition: opt(formData, 'condition'),
      sourceUrl: opt(formData, 'modifierSourceUrl'),
      verifiedOn: opt(formData, 'modifierVerifiedOn'),
      status: str(formData, 'modifierStatus') as LevyStatus,
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function removeModifierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const activityId = str(formData, 'activityId')
  try {
    await removeModifier(userId, str(formData, 'modifierId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function setInputAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, [
    { name: 'name' },
    { name: 'validFrom', kind: 'date' },
    { name: 'value' },
  ])
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await setInput(userId, activityId, {
      name: str(formData, 'name'),
      validFrom: str(formData, 'validFrom'),
      value: n.num('value'),
      note: opt(formData, 'note'),
    })
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function removeInputAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const activityId = str(formData, 'activityId')
  try {
    await removeInput(userId, str(formData, 'inputId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

function thresholdFrom(formData: FormData, n: Numbers) {
  return {
    label: str(formData, 'label'),
    measure: str(formData, 'measure') as ThresholdMeasure,
    periodRef: str(formData, 'periodRef') as PeriodRef,
    comparison: str(formData, 'comparison') === 'gte' ? ('gte' as const) : ('lte' as const),
    value: n.num('value'),
    consequence: str(formData, 'consequence'),
    sourceUrl: opt(formData, 'sourceUrl') ?? null,
    verifiedOn: opt(formData, 'verifiedOn') ?? null,
    reviewOn: opt(formData, 'reviewOn') ?? null,
  }
}

const THRESHOLD_RULES: FieldRule[] = [
  { name: 'label' },
  { name: 'measure' },
  { name: 'value' },
  { name: 'consequence' },
]

export async function createThresholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, THRESHOLD_RULES)
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await createThreshold(userId, activityId, thresholdFrom(formData, n))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function editThresholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const n = await numbersOf(formData)
  const invalid = await checkFields(formData, THRESHOLD_RULES)
  if (invalid) return { fields: invalid }
  const activityId = str(formData, 'activityId')
  try {
    await editThreshold(userId, str(formData, 'thresholdId'), thresholdFrom(formData, n))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}

export async function removeThresholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const activityId = str(formData, 'activityId')
  try {
    await removeThreshold(userId, str(formData, 'thresholdId'))
  } catch (e) {
    return { error: await refusal(e) }
  }
  refreshActivity(activityId)
  return { ok: true }
}
