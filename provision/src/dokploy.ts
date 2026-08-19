/**
 * Minimal typed adapter over the Dokploy REST API, trimmed to what abacus
 * needs: a project, one compose service, and its domains.
 *
 * Hard-won details from the infra repository, still true on v0.29.x:
 *   - The auth header is `x-api-key`; `Authorization: Bearer` answers 401.
 *   - No OpenAPI spec is served, but validation errors return Zod issues that
 *     name the offending fields.
 *   - Hierarchy is project -> environment -> service; services take an
 *     environmentId, never a projectId.
 *   - A fresh compose is created as sourceType "github" with an empty file; it
 *     has to be updated to "raw" with the YAML inline before it can deploy.
 *   - Deployments are asynchronous: the call returns "queued", not a result.
 *   - `domain.byComposeId` nests the whole compose object, env included: never
 *     log such a response as-is.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { optional, required } from './env.ts'

const TOKEN_FILE = join(homedir(), '.config', 'dokploy', 'token')

/** Public repository: the control-plane address never appears in it. */
const BASE = required('DOKPLOY_URL').replace(/\/+$/, '')

const TOKEN = (() => {
  const fromEnv = optional('DOKPLOY_AUTH_TOKEN')
  if (fromEnv) return fromEnv
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    throw new Error(`No Dokploy token. Set DOKPLOY_AUTH_TOKEN or write it to ${TOKEN_FILE}`)
  }
})()

type Params = Record<string, string | number | boolean | string[] | undefined>

async function request<T>(method: 'GET' | 'POST', procedure: string, payload: Params = {}): Promise<T> {
  const url = new URL(`${BASE}/api/${procedure}`)
  const init: RequestInit = { method, headers: { 'x-api-key': TOKEN } }

  if (method === 'GET') {
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  } else {
    init.headers = { ...(init.headers as Record<string, string>), 'content-type': 'application/json' }
    init.body = JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)))
  }

  const res = await fetch(url, init)
  const text = await res.text()

  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const body = JSON.parse(text) as { message?: string; issues?: { path?: string[]; message?: string }[] }
      if (body.issues?.length) {
        detail = body.issues.map((i) => `${(i.path ?? []).join('.')}: ${i.message}`).join('; ')
      } else if (body.message) {
        detail = body.message
      }
    } catch {
      /* keep the raw body */
    }
    throw new Error(`${procedure} -> HTTP ${res.status}: ${detail}`)
  }

  return (text ? JSON.parse(text) : undefined) as T
}

const query = <T>(procedure: string, params?: Params) => request<T>('GET', procedure, params)
const mutate = <T>(procedure: string, body?: Params) => request<T>('POST', procedure, body)

export type ComposeRef = { composeId: string; name: string; composeStatus?: string }
export type Environment = {
  environmentId: string
  name: string
  isDefault?: boolean
  compose?: ComposeRef[]
}
export type Project = { projectId: string; name: string; environments?: Environment[] }
export type Compose = {
  composeId: string
  name: string
  sourceType: string
  composeFile: string
  env?: string
}
export type Domain = { domainId: string; host: string; port?: number; serviceName?: string }

export const projects = {
  all: () => query<Project[]>('project.all'),
  create: (name: string, description: string) =>
    mutate<Project>('project.create', { name, description }),
}

export const compose = {
  one: (composeId: string) => query<Compose>('compose.one', { composeId }),
  create: (o: { name: string; description: string; environmentId: string; composeType: string }) =>
    mutate<Compose>('compose.create', o),
  update: (o: { composeId: string; sourceType?: string; composeFile?: string; env?: string }) =>
    mutate<Compose>('compose.update', o),
  deploy: (composeId: string) => mutate<unknown>('compose.deploy', { composeId }),
}

export const domains = {
  byComposeId: (composeId: string) => query<Domain[]>('domain.byComposeId', { composeId }),
  create: (o: {
    host: string
    port: number
    https: boolean
    certificateType: string
    domainType: string
    composeId: string
    serviceName: string
  }) => mutate<Domain>('domain.create', o),
}

export function findEnvironment(project: Project, name = 'production'): Environment {
  const envs = project.environments ?? []
  const found = envs.find((e) => e.name === name) ?? envs.find((e) => e.isDefault)
  if (!found) throw new Error(`Project ${project.name} has no '${name}' environment`)
  return found
}
