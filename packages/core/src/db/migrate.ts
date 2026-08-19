import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb, db } from './client.ts'

/**
 * Migration runner.
 *
 * Forward-only by design: there is no down script. A down() that is never run
 * in production is a comfort, not a safety net; a mistake is corrected by the
 * next migration.
 *
 * Everything runs inside one transaction holding a transaction-scoped advisory
 * lock, so two processes starting together cannot migrate at the same time,
 * and a failure leaves the schema untouched.
 */

const migrationsDir = fileURLToPath(new URL('../../../../migrations/', import.meta.url))

export async function migrate(): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  const sql = db()

  await sql.begin(async (tx) => {
    // The key is derived from the database name so it cannot collide with
    // another application on the shared instance. PostgreSQL does not document
    // whether the advisory lock space is per database or per cluster, and this
    // works either way rather than depending on the answer.
    await tx`select pg_advisory_xact_lock(hashtext(current_database() || ':abacus:migrations'))`

    // Created inside the lock on purpose: creating it outside is a known race.
    await tx`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `

    const rows = await tx<{ name: string }[]>`select name from schema_migrations`
    const done = new Set(rows.map((r) => r.name))

    for (const file of files) {
      if (done.has(file)) continue
      const script = await readFile(join(migrationsDir, file), 'utf8')
      // simple() switches to the simple query protocol, the only one that
      // accepts several statements in a single message.
      await tx.unsafe(script).simple()
      await tx`insert into schema_migrations (name) values (${file})`
      applied.push(file)
    }
  })

  return applied
}

if (import.meta.filename === process.argv[1]) {
  const applied = await migrate()
  console.log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'already up to date')
  await closeDb()
}
