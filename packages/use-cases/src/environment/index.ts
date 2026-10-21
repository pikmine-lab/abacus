import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { cpSync, globSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { packageDatabaseUrl, prepareTestDatabase } from '../../../../scripts/test-db.mjs'
import { globalSetup as startMarket, globalTeardown as stopMarket } from '../../../../scripts/test-market.mjs'

/**
 * The one configuration every driver reads: the servers the suite started,
 * the day it plays on, and how long a gesture may take. No driver has a
 * configuration of its own.
 *
 * The global setup builds the web app, then serves it and the MCP server on
 * local ports, against this package's test database and the local market,
 * with the network cut and the clock on SUITE_DAY in every process. The test
 * files reach them through the environment they inherit.
 */

/** The day the whole suite plays on, so no result depends on when it runs. */
export const SUITE_DAY = '2026-06-15'

export interface Environment {
  webUrl: string
  mcpUrl: string
  today: string
  /** The longest a single gesture may take before the driver gives up. */
  timeoutMs: number
}

export function environment(): Environment {
  const webUrl = process.env.ABACUS_CASES_WEB_URL
  const mcpUrl = process.env.ABACUS_CASES_MCP_URL
  if (!webUrl || !mcpUrl)
    throw new Error('The use case servers are not running: run the suite through its test script')
  return { webUrl, mcpUrl, today: SUITE_DAY, timeoutMs: 15_000 }
}

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const web = `${root}apps/web/`
const servers: ChildProcess[] = []

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitFor(url: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`${url}: the server exited with ${server.exitCode}`)
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`${url}: the server did not answer within a minute`)
}

function serve(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const server = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
  servers.push(server)
  return server
}

/**
 * Each run serves the MCP on a port of its own, so a resource of its own, which
 * the auth server links every pre-registered client to. Kept from run to run
 * in the suite's database, those links pile up, and past a hundred the auth
 * server no longer reads the current one. Dropped before the servers start;
 * they link the current address again as they come up.
 */
async function forgetFormerServers(databaseUrl: string): Promise<void> {
  const postgres = createRequire(`${root}packages/core/package.json`)('postgres')
  const sql = postgres(databaseUrl, { onnotice: () => {} })
  try {
    await sql`delete from auth_oauth_client_resource`
    await sql`delete from auth_oauth_resource`
  } finally {
    await sql.end()
  }
}

async function startServers(env: NodeJS.ProcessEnv, webPort: number, mcpPort: number): Promise<void> {
  const webServer = serve([`${web}.next/standalone/apps/web/server.js`], {
    ...env,
    PORT: String(webPort),
    HOSTNAME: '127.0.0.1',
  })
  const mcpServer = serve([`${root}apps/mcp/src/main.ts`], { ...env, PORT: String(mcpPort) })
  await waitFor(`http://127.0.0.1:${webPort}`, webServer)
  await waitFor(`http://127.0.0.1:${mcpPort}/.well-known/oauth-protected-resource`, mcpServer)
}

export async function globalSetup(): Promise<void> {
  // Where each driver notes what it really called, read back at the end.
  process.env.ABACUS_CASES_EXERCISED = mkdtempSync(`${tmpdir()}/abacus-cases-`)
  const base = process.env.TEST_DATABASE_URL
  if (!base) throw new Error('TEST_DATABASE_URL is not set: run `nr db:test:env` to write .env.test')
  const databaseUrl = packageDatabaseUrl(base, '@abacus/use-cases')
  await prepareTestDatabase(databaseUrl)
  await forgetFormerServers(databaseUrl)
  await startMarket()

  const [webPort, mcpPort] = [await freePort(), await freePort()]
  const webUrl = `http://127.0.0.1:${webPort}`
  const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    // Fixed, not drawn per run: the signing keys stay in the suite's database,
    // encrypted with it. A test value, guarding nothing but test users.
    BETTER_AUTH_SECRET: 'abacus-use-case-suite-only-secret-not-for-anything-else',
    PUBLIC_URL: webUrl,
    MCP_URL: mcpUrl,
    ABACUS_TEST_TODAY: SUITE_DAY,
    NODE_OPTIONS: `--import=${root}scripts/test-preload.mjs`,
  }

  // ABACUS_CASES_REUSE_BUILD=1 serves the last build, to go faster while writing
  // a case whose app code did not change; the suite in CI always builds.
  if (process.env.ABACUS_CASES_REUSE_BUILD !== '1')
    execFileSync('pnpm', ['--filter', '@abacus/web', 'build'], {
      cwd: root,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  // Completed as the image completes it (apps/web/Dockerfile): the static assets
  // beside the server, and the esm/ entries of @swc/helpers the tracer leaves out.
  cpSync(`${web}.next/static`, `${web}.next/standalone/apps/web/.next/static`, { recursive: true })
  for (const helpers of globSync('node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers', {
    cwd: root,
  }))
    cpSync(`${root}${helpers}/esm`, `${web}.next/standalone/${helpers}/esm`, { recursive: true })

  try {
    await startServers(env, webPort, mcpPort)
  } catch (error) {
    await globalTeardown()
    throw error
  }

  process.env.ABACUS_CASES_WEB_URL = webUrl
  process.env.ABACUS_CASES_MCP_URL = mcpUrl
  process.env.DATABASE_URL = databaseUrl
  process.env.PUBLIC_URL = webUrl
  process.env.MCP_URL = mcpUrl
  process.env.ABACUS_TEST_TODAY = SUITE_DAY
}

export async function globalTeardown(): Promise<void> {
  for (const server of servers) server.kill('SIGTERM')
  await stopMarket()
  // Only a full run can say what no case covers: the package's test script
  // asks for it, a run narrowed to some cases or some drivers does not.
  if (process.env.ABACUS_CASES_COVERAGE === '1') await checkCoverage()
}

async function checkCoverage(): Promise<void> {
  const { coverageProblems } = await import('../guards/inventory.ts')
  const { realInterfaces } = await import('../guards/real-interfaces.ts')
  const { gestures, informations } = await import('../inventory/index.ts')
  const folder = process.env.ABACUS_CASES_EXERCISED as string
  const exercised = readdirSync(folder).flatMap((file) =>
    readFileSync(`${folder}/${file}`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  )
  const problems = coverageProblems({ gestures, informations }, await realInterfaces(), exercised)
  if (problems.length === 0) return
  for (const problem of problems) console.error(problem)
  console.error(`${problems.length} gestures or informations of the inventory are exercised by no case.`)
  process.exitCode = 1
}
