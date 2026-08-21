import type { Account, Activity, Actor, Asset, Category, Commitment } from '@abacus/core/domain'
import { DomainError } from '@abacus/core/domain/errors'
import { listAccounts } from '@abacus/core/services/accounts'
import { createActor, resolveActor } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listCommitments } from '@abacus/core/services/commitments'
import { listAssets } from '@abacus/core/services/investments'

/**
 * Every tool takes names, never ids: the AI on the other side sees the user's
 * vocabulary, not the database. Resolution failures must therefore be
 * self-sufficient error messages: say what was searched, what exists or what
 * is close, and which tool fixes it.
 */

function byName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const wanted = name.trim().toLowerCase()
  return items.find((i) => i.name.toLowerCase() === wanted)
}

export async function requireAccountByName(userId: string, name: string): Promise<Account> {
  const accounts = await listAccounts(userId)
  const account = byName(accounts, name)
  if (!account)
    throw new DomainError(
      'account_not_found',
      `No account named "${name}". Existing accounts: ${accounts.map((a) => a.name).join(', ') || 'none'}. Create it with manage_accounts if needed.`,
    )
  return account
}

export async function requireCategoryByName(userId: string, name: string): Promise<Category> {
  const categories = await listCategories(userId)
  const category = byName(categories, name)
  if (!category)
    throw new DomainError(
      'category_not_found',
      `No category "${name}". Existing categories: ${categories.map((c) => c.name).join(', ') || 'none'}. Create it with manage_categories; never guess a close one.`,
    )
  return category
}

export async function requireActivityByName(userId: string, name: string): Promise<Activity> {
  const activities = await listActivities(userId)
  const activity = byName(activities, name)
  if (!activity)
    throw new DomainError(
      'activity_not_found',
      `No activity "${name}". Existing activities: ${activities.map((a) => a.name).join(', ') || 'none'}. Create it with manage_activities if intended.`,
    )
  return activity
}

/**
 * Actor resolution follows the normalization contract: exact name or alias
 * wins; otherwise the caller gets close matches and decides (reuse one, or
 * create). `createIfUnknown` short-circuits that decision for batch entry.
 */
export async function requireActorByName(
  userId: string,
  name: string,
  opts: { createIfUnknown?: boolean } = {},
): Promise<{ actor: Actor; created: boolean }> {
  const resolution = await resolveActor(userId, name)
  if (resolution.match) return { actor: resolution.match, created: false }
  if (opts.createIfUnknown) {
    return { actor: await createActor(userId, { name: name.trim() }), created: true }
  }
  const close = resolution.suggestions.map((s) => s.name)
  throw new DomainError(
    'actor_unknown',
    close.length > 0
      ? `Unknown actor "${name}". Close existing names: ${close.join(', ')}. Reuse one of them (and record "${name}" as an alias via manage_actors), or retry with createUnknownActors: true to create it.`
      : `Unknown actor "${name}" and nothing close to it. Retry with createUnknownActors: true to create it, or create it first via manage_actors.`,
  )
}

/** Commitments are addressed by their label (or id, for disambiguation). */
export async function requireCommitment(userId: string, labelOrId: string): Promise<Commitment> {
  const all = await listCommitments(userId, false)
  const wanted = labelOrId.trim().toLowerCase()
  const matches = all.filter((c) => c.id === labelOrId || c.label.toLowerCase() === wanted)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1)
    throw new DomainError(
      'commitment_ambiguous',
      `Several commitments are labeled "${labelOrId}". Use the id: ${matches.map((c) => `${c.label} (${c.id})`).join(', ')}.`,
    )
  const active = all.filter((c) => !c.cancelledOn)
  throw new DomainError(
    'commitment_not_found',
    `No commitment "${labelOrId}". Active commitments: ${active.map((c) => c.label).join(', ') || 'none'}.`,
  )
}

/** Holdings are addressed by the name the user gave them, like everything else. */
export async function requireAssetByName(userId: string, name: string): Promise<Asset> {
  const assets = await listAssets(userId)
  const asset = byName(assets, name)
  if (!asset)
    throw new DomainError(
      'asset_not_found',
      `No asset named "${name}". Held assets: ${assets.map((a) => a.name).join(', ') || 'none'}. Declare it with manage_assets before recording an operation on it.`,
    )
  return asset
}
