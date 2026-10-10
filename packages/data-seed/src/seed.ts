import { activity } from './activity.ts'
import { cards, validateStatements } from './cards.ts'
import { checks } from './checks.ts'
import { commitments } from './commitments.ts'
import { everyday } from './everyday.ts'
import { investments } from './investments.ts'
import { ledger } from './ledger.ts'
import { assertLocalDatabase, demoUser, wipe } from './user.ts'

/**
 * Rewrites the demo account from scratch, its whole history ending today.
 * Everything goes through the services of @abacus/core, as the web app and
 * the MCP server do, so the data holds every rule the domain enforces and
 * cannot say anything the two interfaces could not.
 *
 * The order is the order of reality: the referential, then what happened,
 * then what the person checks against it. Balance checks come last because
 * each one freezes the balance the books gave on its day.
 */
export async function seedDemo(): Promise<string> {
  assertLocalDatabase()
  const userId = await demoUser()
  await wipe(userId)

  const world = await ledger(userId)
  const owned = await cards(userId, world)
  await commitments(userId, world, owned)
  await everyday(userId, world, owned)
  await investments(userId, world)
  await activity(userId, world, owned)
  await validateStatements(userId, owned)
  await checks(userId, world)
  return userId
}
