import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

/**
 * Better Auth owns authentication end to end: users, sessions, and the
 * per-user API keys the MCP server authenticates with.
 *
 * Every table is prefixed auth_ because the default names collide with the
 * domain ("account" is a bank account here, not an OAuth account). The schema
 * is not created at runtime: it is generated with
 * `npx @better-auth/cli generate` into migrations/0001_auth.sql and applied by
 * the regular migration runner.
 */
export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL: process.env.PUBLIC_URL,
  emailAndPassword: {
    enabled: true,
  },
  user: { modelName: 'auth_user' },
  session: { modelName: 'auth_session' },
  account: { modelName: 'auth_account' },
  verification: { modelName: 'auth_verification' },
  plugins: [
    apiKey({
      schema: {
        apikey: { modelName: 'auth_apikey' },
      },
    }),
  ],
})
