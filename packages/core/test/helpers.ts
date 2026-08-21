import { closeDb, db } from '../src/db/client.ts'
import { migrate } from '../src/db/migrate.ts'

// Guard against a misconfigured environment wiping the dev database: these
// helpers truncate everything, so they refuse to run anywhere else.
if (!process.env.DATABASE_URL?.includes('abacus_test')) {
  throw new Error('Tests must run against the abacus_test database')
}

export async function setupDb(): Promise<void> {
  await migrate()
}

export async function truncateAll(): Promise<void> {
  await db()`
    truncate financing_installment, movement, balance_check, commitment_event, commitment, actor_alias, actor,
             category, activity, account, investment_operation, asset, instrument,
             auth_apikey, auth_session, auth_account, auth_verification, auth_user
    cascade
  `
}

export async function teardownDb(): Promise<void> {
  await closeDb()
}

export async function seedUser(id = 'user-1'): Promise<string> {
  await db()`
    insert into auth_user (id, name, email, "emailVerified")
    values (${id}, ${`User ${id}`}, ${`${id}@test.local`}, true)
  `
  return id
}
