// The test databases: one per package of each worktree (or of the CI).
//
// The tests of a package empty their tables before each test, and packages run
// in parallel: sharing a database, they would wipe each other's data, as two
// worktrees did when every test ran against `abacus_test`. So a worktree gets a
// base address in its .env.test, TEST_DATABASE_URL=…/abacus_test_<branch>, and
// each package derives its own database from it, `<base>_<package>`, created
// with its extensions and migrated the first time it is used.
//
// Nothing runs against a database whose name is not a test one: the guard
// below is checked before any write, here and in the test helpers. Known limit:
// the dev database of a branch whose name starts with "test" (abacus_test_foo)
// has a test database's name, and would be accepted.
//
// Usage, for the worktree hooks:
//   node packages/test-harness/src/database.ts env    write .env.test for the current branch
//   node packages/test-harness/src/database.ts drop   drop every database under its base

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const TEST_DATABASE = /^abacus_test(_[a-z0-9_]+)+$/
const EXTENSIONS = ['vector', 'pg_trgm', 'unaccent']
const root = new URL('../../../', import.meta.url)

function nameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1))
}

function withName(url: string, name: string): string {
  const copy = new URL(url)
  copy.pathname = `/${name}`
  return copy.toString()
}

/** Lowercase, and anything but letters and digits made an underscore. */
function sanitize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export function assertTestDatabase(url: string): void {
  const name = nameOf(url)
  if (!TEST_DATABASE.test(name)) {
    const error: Error & { code?: string } = new Error(
      `not_a_test_database: "${name}" is not a test database (abacus_test_<branch>_<package>); ` +
        'nothing was written. Is TEST_DATABASE_URL set? Run `nr db:test:env`.',
    )
    error.code = 'not_a_test_database'
    throw error
  }
}

/** The database of one package under a worktree's base: `@abacus/data-seed` → `<base>_data_seed`. */
export function packageDatabaseUrl(base: string, packageName: string): string {
  return withName(base, `${nameOf(base)}_${sanitize(packageName.replace(/^@abacus\//, ''))}`)
}

async function onServer<T>(url: string, run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(withName(url, 'postgres'), { onnotice: () => {} })
  try {
    return await run(sql)
  } finally {
    await sql.end()
  }
}

/** Creates the database the first time, with its extensions, then brings its schema up to date. */
export async function prepareTestDatabase(url: string): Promise<void> {
  assertTestDatabase(url)
  const name = nameOf(url)
  await onServer(url, async (sql) => {
    const [exists] = await sql`select 1 from pg_database where datname = ${name}`
    if (exists) return
    // Two packages starting together may both find it missing.
    await sql.unsafe(`create database "${name}"`).catch((error: { code?: string }) => {
      if (error.code !== '42P04') throw error
    })
  })
  const sql = postgres(url, { onnotice: () => {} })
  try {
    for (const extension of EXTENSIONS) await sql.unsafe(`create extension if not exists ${extension}`)
  } finally {
    await sql.end()
  }
  // In its own process: the migration runner holds a pool opened on DATABASE_URL.
  // Called by its path: core's own tests use this harness, so it cannot depend on core.
  execFileSync(process.execPath, [fileURLToPath(new URL('packages/core/src/db/migrate.ts', root))], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
}

/** Drops the base database and every `<base>_…` one, open connections closed. */
export async function dropTestDatabases(base: string): Promise<void> {
  assertTestDatabase(withName(base, `${nameOf(base)}_x`))
  const name = nameOf(base)
  await onServer(base, async (sql) => {
    const rows =
      await sql`select datname from pg_database where datname = ${name} or starts_with(datname, ${`${name}_`})`
    for (const { datname } of rows) await sql.unsafe(`drop database if exists "${datname}" with (force)`)
  })
}

function branchBase(): string {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  return `postgresql://abacus:abacus@127.0.0.1:5544/abacus_test_${sanitize(branch)}`
}

const envFile = new URL('.env.test', root)

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command === 'env') {
    writeFileSync(envFile, `TEST_DATABASE_URL=${branchBase()}\n`)
  } else if (command === 'drop') {
    const line = readFileSync(envFile, 'utf8').match(/^TEST_DATABASE_URL=(.+)$/m)
    await dropTestDatabases(line ? line[1] : branchBase())
  } else {
    console.error('usage: database.ts env | drop')
    process.exitCode = 2
  }
}
