// The global setup of a package's tests, run once by `--test-global-setup`
// before its test files: the package's own test database, prepared and
// migrated, and the local market. Both reach the test files through the
// environment they inherit.
//
// The package is the one whose directory the tests run from, as pnpm runs a
// package's scripts. DATABASE_URL is always replaced, so a value left in the
// shell never decides where the tests write.

import { readFileSync } from 'node:fs'
import { packageDatabaseUrl, prepareTestDatabase } from './database.ts'
import { globalSetup as startMarket, globalTeardown as stopMarket } from './market.ts'

export async function globalSetup(): Promise<void> {
  const base = process.env.TEST_DATABASE_URL
  if (!base) throw new Error('TEST_DATABASE_URL is not set: run `nr db:test:env` to write .env.test')
  const { name } = JSON.parse(readFileSync('package.json', 'utf8'))
  process.env.DATABASE_URL = packageDatabaseUrl(base, name)
  await prepareTestDatabase(process.env.DATABASE_URL)
  // Local addresses the auth and MCP code needs to build its URLs; nothing listens there.
  process.env.PUBLIC_URL ??= 'http://127.0.0.1:43180'
  process.env.MCP_URL ??= 'http://127.0.0.1:43180/mcp'
  await startMarket()
}

export async function globalTeardown(): Promise<void> {
  await stopMarket()
}
