/**
 * In GitHub Actions, reads what the provisioner needs from the vault instead of
 * GitHub secrets. Locally it does nothing: provision/.env or the environment
 * provide the same variables, as before.
 *
 * The job asks GitHub for an OIDC token naming this repository and its branch,
 * and trades it for a vault access token. The vault identity (`ci-apps`, its id
 * in the repository variable INFISICAL_IDENTITY_ID) only accepts tokens signed
 * for main of the repositories listed in the infra repository. It reads two
 * places: the Dokploy credentials shared by every application CI (project
 * `ci`, folder /apps), and this application's runtime secrets (project
 * `abacus`).
 *
 * API, the same calls the infra provisioner makes against this vault:
 *   POST /api/v1/auth/oidc-auth/login  -> { accessToken }
 *   GET  /api/v1/workspace             -> { workspaces: [{ name, slug }] }
 *   GET  /api/v3/secrets/raw           -> { secrets: [{ secretKey, secretValue }] }
 */
import { required } from './env.ts'

const VAULT = (process.env.INFISICAL_URL ?? 'https://vault.np4.dev').replace(/\/+$/, '')
/** Cloudflare in front of the vault refuses a client it does not recognise (error code 1010). */
const USER_AGENT = 'abacus-provision/1'
/** Audience requested from GitHub, and bound on the identity in the vault. */
const AUDIENCE = 'https://github.com/pikmine-lab'
const ENVIRONMENT = 'prod'

/** Where each variable the provisioner reads lives in the vault. */
const SOURCES = [
  {
    project: 'ci',
    folder: '/apps',
    keys: { DOKPLOY_URL: 'DOKPLOY_URL', DOKPLOY_TOKEN: 'DOKPLOY_AUTH_TOKEN' },
  },
  {
    project: 'abacus',
    folder: '/',
    keys: { DATABASE_URL: 'DATABASE_URL', BETTER_AUTH_SECRET: 'BETTER_AUTH_SECRET' },
  },
] as const

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${VAULT}${path}`, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers as Record<string, string>) },
  })
  const text = await res.text()
  if (!res.ok) {
    // Only the API's own message: a raw body could echo what was sent.
    let detail = text.includes('1010') ? 'refused by Cloudflare (code 1010)' : 'unexpected response'
    try {
      const body = JSON.parse(text) as { message?: unknown }
      if (body.message) detail = JSON.stringify(body.message).slice(0, 300)
    } catch {}
    throw new Error(`vault ${path.split('?')[0]} -> HTTP ${res.status}: ${detail}`)
  }
  return JSON.parse(text) as T
}

async function login(): Promise<string> {
  const identityId = required('INFISICAL_IDENTITY_ID')
  const url = new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'))
  url.searchParams.set('audience', AUDIENCE)
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` },
  })
  if (!res.ok) throw new Error(`GitHub OIDC token -> HTTP ${res.status}. Does the job grant id-token: write?`)
  const { value: jwt } = (await res.json()) as { value: string }

  const { accessToken } = await call<{ accessToken: string }>('/api/v1/auth/oidc-auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityId, jwt }),
  })
  return accessToken
}

export async function loadCiSecrets(): Promise<void> {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) return

  const auth = { authorization: `Bearer ${await login()}` }
  // Project slugs carry a random suffix: a project is resolved by its name.
  const { workspaces = [] } = await call<{ workspaces?: { name: string; slug: string }[] }>(
    '/api/v1/workspace',
    {
      headers: auth,
    },
  )

  for (const { project, folder, keys } of SOURCES) {
    const slug = workspaces.find((w) => w.name === project)?.slug
    if (!slug) throw new Error(`Vault project '${project}' is not visible to the ci-apps identity.`)

    const params = new URLSearchParams({ workspaceSlug: slug, environment: ENVIRONMENT, secretPath: folder })
    const { secrets = [] } = await call<{ secrets?: { secretKey: string; secretValue: string }[] }>(
      `/api/v3/secrets/raw?${params}`,
      { headers: auth },
    )
    for (const [key, variable] of Object.entries(keys)) {
      const value = secrets.find((s) => s.secretKey === key)?.secretValue.trim()
      if (!value) throw new Error(`Missing ${project}:${folder} ${key} in the vault.`)
      // Masked in the job log should anything ever print it.
      console.log(`::add-mask::${value}`)
      process.env[variable] = value
    }
  }
}
