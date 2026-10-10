import { auth } from '@abacus/core/auth'
import { db } from '@abacus/core/db'

/**
 * The account the demo data belongs to. Local and throwaway: these are not
 * secrets, and AGENTS.md gives them to whoever opens the app to try a screen.
 */
export const DEMO_EMAIL = 'demo@abacus.local'
export const DEMO_PASSWORD = 'demo-abacus'
const DEMO_NAME = 'Camille'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The seed wipes and rewrites a whole account, so it refuses any database that
 * is not on this machine: nothing it writes may ever reach production.
 */
export function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const host = new URL(url).hostname
  if (!LOCAL_HOSTS.has(host))
    throw new Error(`The data seed only writes to a local database, and ${host} is not one`)
}

/**
 * The demo account, created through Better Auth the first time so its password
 * signs in like any other, and kept afterwards: a reseed leaves its sessions
 * alone, so a browser signed in as the demo stays signed in.
 */
export async function demoUser(): Promise<string> {
  const [existing] = await db()<{ id: string }[]>`select id from auth_user where email = ${DEMO_EMAIL}`
  if (existing) return existing.id
  const { user } = await auth.api.signUpEmail({
    body: { name: DEMO_NAME, email: DEMO_EMAIL, password: DEMO_PASSWORD },
  })
  return user.id
}

/**
 * Every table a user owns rows of, children before what they point at. The
 * tables without an owner column (aliases, installments, statements, events,
 * an activity's links) go with their parent by cascade. A table added to the
 * domain and missing here makes the delete of its parent fail, which is the
 * point: it is then added here.
 */
export const OWNED_TABLES = [
  'levy_nil_return',
  'investment_operation',
  'movement',
  'balance_check',
  'invoice',
  'commitment',
  'card',
  'levy',
  'activity_input',
  'threshold',
  'asset',
  'actor',
  'activity',
  'category',
  'account',
  'user_preference',
]

/**
 * Deletes everything the demo account owns, so the seed always writes a whole
 * history ending today rather than appending to one that has aged. Shared rows
 * are left alone: an instrument and its prices belong to no one.
 */
export async function wipe(userId: string): Promise<void> {
  await db().begin(async (tx) => {
    for (const table of OWNED_TABLES) await tx`delete from ${tx(table)} where user_id = ${userId}`
  })
}

/**
 * Better Auth holds a pg pool of its own, built from the same DATABASE_URL:
 * left open, its idle connection keeps the process alive ten more seconds.
 */
export async function closeAuth(): Promise<void> {
  await (auth.options.database as { end(): Promise<void> }).end()
}
