import type { UserPreference } from '../../domain/types.ts'
import type { Executor } from '../client.ts'

export async function getPreferences(tx: Executor, userId: string): Promise<UserPreference | undefined> {
  const [row] = await tx<UserPreference[]>`select * from user_preference where user_id = ${userId}`
  return row
}

/**
 * Writes a preference, creating the row on the way: nobody is created in this
 * table at signup, so the first setting is also the row's first existence.
 */
export async function upsertPreferences(
  tx: Executor,
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserPreference> {
  const [row] = await tx<UserPreference[]>`
    insert into user_preference ${tx({ userId, ...patch })}
    on conflict (user_id) do update set ${tx(patch)}, updated_at = now()
    returning *
  `
  return row!
}
