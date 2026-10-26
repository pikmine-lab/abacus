/**
 * Gathers what the deployment needs from the vault. In GitHub Actions the job
 * asks GitHub for an OIDC token naming this repository and its branch, and
 * trades it for a vault access token: no GitHub secret is involved. The vault
 * identity, whose id is the repository variable INFISICAL_IDENTITY_ID, only
 * accepts a token signed for main of this repository.
 *
 * Locally nothing is fetched: provision/.env provides the same variables.
 *
 * Platform contract (see the doctrine in the infra repository): the Dokploy
 * credentials shared by every application CI live in project `ci`, folder
 * /apps, environment `prod`.
 *
 * API:
 *   POST /api/v1/auth/oidc-auth/login  -> { accessToken }
 *   GET  /api/v1/workspace             -> { workspaces: [{ name, slug }] }
 *   GET  /api/v3/secrets/raw           -> { secrets: [{ secretKey, secretValue }] }
 */
import { required } from './env.ts'
import { SPEC } from './specs.ts'

const ENVIRONMENT = 'prod'
const SHARED = { project: 'ci', path: '/apps' }
/** Vault key -> variable the Dokploy client reads. */
const DOKPLOY_KEYS = { DOKPLOY_URL: 'DOKPLOY_URL', DOKPLOY_TOKEN: 'DOKPLOY_AUTH_TOKEN' } as const
/** The proxy in front of the vault refuses a client it does not recognise. */
const USER_AGENT = `${SPEC.project}-provision/1`

const inCi = () => Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL)

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SPEC.vault.url.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers as Record<string, string>) },
  })
  const text = await res.text()
  if (!res.ok) {
    // Only the API's own message: a raw body could echo what was sent.
    let detail = text.includes('1010') ? 'refused by the proxy (code 1010)' : 'unexpected response'
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
  url.searchParams.set('audience', SPEC.vault.audience)
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

/**
 * Returns the value of every secret declared in SPEC.secrets, by name. In CI it
 * also sets the Dokploy credentials and the `for: 'ci'` secrets in the
 * environment, each masked in the job log.
 */
export async function loadSecrets(): Promise<Map<string, string>> {
  const values = new Map<string, string>()
  if (!inCi()) {
    for (const s of SPEC.secrets) values.set(s.name, required(s.name))
    return values
  }

  const auth = { authorization: `Bearer ${await login()}` }
  // Project slugs carry a random suffix: a project is resolved by its name.
  const { workspaces = [] } = await call<{ workspaces?: { name: string; slug: string }[] }>(
    '/api/v1/workspace',
    {
      headers: auth,
    },
  )

  const folders = new Map<string, { secretKey: string; secretValue: string }[]>()
  async function pick(project: string, path: string, key: string): Promise<string> {
    const where = `${project}:${path}`
    if (!folders.has(where)) {
      const slug = workspaces.find((w) => w.name === project)?.slug
      if (!slug) throw new Error(`Vault project '${project}' is not visible to this repository's identity.`)
      const params = new URLSearchParams({ workspaceSlug: slug, environment: ENVIRONMENT, secretPath: path })
      const { secrets = [] } = await call<{ secrets?: { secretKey: string; secretValue: string }[] }>(
        `/api/v3/secrets/raw?${params}`,
        { headers: auth },
      )
      folders.set(where, secrets)
    }
    const value = folders
      .get(where)
      ?.find((s) => s.secretKey === key)
      ?.secretValue.trim()
    if (!value) throw new Error(`Missing ${where} ${key} in the vault.`)
    // Masked in the job log should anything ever print it.
    console.log(`::add-mask::${value}`)
    return value
  }

  for (const [key, variable] of Object.entries(DOKPLOY_KEYS)) {
    process.env[variable] = await pick(SHARED.project, SHARED.path, key)
  }
  for (const s of SPEC.secrets) {
    const value = await pick(s.project, s.path, s.key ?? s.name)
    values.set(s.name, value)
    if (s.for === 'ci') process.env[s.name] = value
  }
  return values
}
