import postgres from 'postgres'

/**
 * What a datasource runs its queries on: either the pool itself or an open
 * transaction.
 *
 * Datasources take one as a parameter so that several of them can take part in
 * a single transaction. Confirming a commitment occurrence means inserting the
 * movement and advancing the commitment's next due date: those must succeed or
 * fail together, which is impossible if every datasource opens its own
 * connection.
 *
 * This abstraction is not here to make the driver swappable. That will not
 * happen, and pretending otherwise would buy nothing.
 */
export type Executor = postgres.ISql

let pool: postgres.Sql | undefined

/**
 * The connection is built from DATABASE_URL alone. The host name is generated
 * by the hosting provider and must never be hardcoded: recreating the instance
 * would change it and break the application.
 */
export function db(): postgres.Sql {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    pool = postgres(url)
  }
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}
