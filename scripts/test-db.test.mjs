import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, test } from 'node:test'
import { assertTestDatabase, dropTestDatabases, packageDatabaseUrl, prepareTestDatabase } from './test-db.mjs'

/**
 * Each package of each worktree tests against its own database, and nothing
 * runs against a database that is not a test one. These tests create and drop
 * databases of their own on the local server, under a prefix nobody else uses.
 */

const postgres = createRequire(new URL('../packages/core/package.json', import.meta.url))('postgres')
const root = new URL('..', import.meta.url)
const server = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://abacus:abacus@127.0.0.1:5544/x')
const run = `abacus_test_selftest${process.pid}`

function urlOf(name) {
  const url = new URL(server)
  url.pathname = `/${name}`
  return url.toString()
}

async function query(name, run) {
  const sql = postgres(urlOf(name), { onnotice: () => {} })
  try {
    return await run(sql)
  } finally {
    await sql.end()
  }
}

const databases = () =>
  query('postgres', async (sql) => (await sql`select datname from pg_database`).map((row) => row.datname))

after(() => dropTestDatabases(urlOf(run)))

test('a database whose name is not a test one is refused, before anything is written', async () => {
  for (const name of ['abacus', 'abacus_main', 'abacus_test', 'abacus_189_freeze', 'abacus_test_']) {
    assert.throws(
      () => assertTestDatabase(urlOf(name)),
      (error) => error.code === 'not_a_test_database' && error.message.includes(name),
      name,
    )
  }
  const missing = `abacus_selftest${process.pid}`
  await assert.rejects(prepareTestDatabase(urlOf(missing)), { code: 'not_a_test_database' })
  assert.ok(!(await databases()).includes(missing), 'the refused database was created')
})

test('the test helpers refuse to load against a database that is not a test one', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./packages/core/test/helpers.ts')"],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: urlOf('abacus') },
          stdio: 'pipe',
        },
      ),
    (error) => String(error.stderr).includes('not_a_test_database'),
  )
})

test('a package database is named after the base and the package', () => {
  const base = urlOf('abacus_test_189_x')
  assert.equal(new URL(packageDatabaseUrl(base, '@abacus/core')).pathname, '/abacus_test_189_x_core')
  assert.equal(
    new URL(packageDatabaseUrl(base, '@abacus/data-seed')).pathname,
    '/abacus_test_189_x_data_seed',
  )
  assert.equal(
    new URL(packageDatabaseUrl(base, '@abacus/use-cases')).pathname,
    '/abacus_test_189_x_use_cases',
  )
})

test('a test database is created on first use, with its extensions, and migrated', async () => {
  const name = `${run}_a_core`
  await prepareTestDatabase(urlOf(name))
  await prepareTestDatabase(urlOf(name))
  const migrations = readdirSync(new URL('migrations/', root)).filter((file) => file.endsWith('.sql'))
  await query(name, async (sql) => {
    const [{ count }] = await sql`select count(*)::int as count from schema_migrations`
    assert.equal(count, migrations.length)
    const extensions = (await sql`select extname from pg_extension`).map((row) => row.extname)
    for (const extension of ['vector', 'pg_trgm', 'unaccent'])
      assert.ok(extensions.includes(extension), extension)
  })
})

test('two branches get two databases, and a write in one is absent from the other', async () => {
  const one = `${run}_one_core`
  const two = `${run}_two_core`
  await prepareTestDatabase(urlOf(one))
  await prepareTestDatabase(urlOf(two))
  await query(one, (sql) => sql`insert into schema_migrations (name) values ('marker')`)
  await query(two, async (sql) => {
    assert.equal((await sql`select 1 from schema_migrations where name = 'marker'`).length, 0)
  })
})

test('dropping a base drops every package database under it, and only those', async () => {
  const base = `${run}_drop`
  const other = `${run}_dropother_core`
  await prepareTestDatabase(urlOf(`${base}_core`))
  await prepareTestDatabase(urlOf(`${base}_mcp`))
  await prepareTestDatabase(urlOf(other))
  await dropTestDatabases(urlOf(base))
  const left = await databases()
  assert.ok(!left.includes(`${base}_core`))
  assert.ok(!left.includes(`${base}_mcp`))
  assert.ok(left.includes(other))
})
