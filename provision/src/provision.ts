/**
 * Idempotent provisioner: reconciles Dokploy against src/specs.ts.
 *
 *   node provision/src/provision.ts --dry-run   # show the gap, change nothing
 *   node provision/src/provision.ts             # apply
 *
 * Inputs (provision/.env locally, environment secrets in CI):
 *   DOKPLOY_URL, DOKPLOY_AUTH_TOKEN, DATABASE_URL, BETTER_AUTH_SECRET,
 *   IMAGE_TAG (immutable sha-… tag produced by the build job).
 *
 * Safe to re-run: every step reads the current state first and acts only on a
 * real difference. Nothing is ever deleted. The one-time database creation
 * (role + database + extensions on the shared instance) is not handled here:
 * it needs SSH, not the Dokploy API, and happens once per environment.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type ComposeRef, compose, domains, findEnvironment, type Project, projects } from './dokploy.ts'
import { required } from './env.ts'
import { SPEC } from './specs.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
const DRY_RUN = process.argv.slice(2).includes('--dry-run')

let changes = 0
const created = (what: string) => {
  changes++
  console.log(`  + created   ${what}`)
}
const updated = (what: string, why: string) => {
  changes++
  console.log(`  ~ updated   ${what}  (${why})`)
}
const same = (what: string) => console.log(`  = unchanged ${what}`)
const planned = (what: string, action: string) => {
  changes++
  console.log(`  ! would ${action}: ${what}`)
}

const imageTag = required('IMAGE_TAG')
if (!/^sha-[0-9a-f]{7,}$/.test(imageTag)) {
  throw new Error(`IMAGE_TAG must be an immutable sha-… tag, got "${imageTag}"`)
}

async function ensureProject(): Promise<Project | null> {
  const existing = (await projects.all()).find((p) => p.name === SPEC.project)
  if (existing) {
    same(`project ${SPEC.project}`)
    return existing
  }
  if (DRY_RUN) {
    planned(`project ${SPEC.project}`, 'create')
    return null
  }
  await projects.create(SPEC.project, SPEC.projectDescription)
  created(`project ${SPEC.project}`)
  // Re-read: the create response does not carry the child collections.
  return (await projects.all()).find((p) => p.name === SPEC.project) ?? null
}

/** Returns true when something changed and the compose must (re)deploy. */
async function ensureDomains(composeId: string): Promise<boolean> {
  const existing = await domains.byComposeId(composeId)
  let changed = false
  for (const spec of SPEC.domains) {
    if (existing.some((d) => d.host === spec.host)) {
      same(`domain ${spec.host}`)
      continue
    }
    if (DRY_RUN) {
      planned(`domain ${spec.host}`, 'create with Let’s Encrypt')
      changed = true
      continue
    }
    await domains.create({
      host: spec.host,
      port: spec.port,
      https: true,
      certificateType: 'letsencrypt',
      domainType: 'compose',
      composeId,
      serviceName: spec.serviceName,
    })
    created(`domain ${spec.host} -> ${spec.serviceName}:${spec.port}`)
    changed = true
  }
  return changed
}

async function ensureCompose(refs: ComposeRef[], environmentId: string) {
  // Normalised to LF so a CRLF checkout never reads as drift.
  const wantedFile = readFileSync(join(ROOT, SPEC.composeFile), 'utf8').replace(/\r\n/g, '\n')
  const wantedEnv = [
    `IMAGE_TAG=${imageTag}`,
    `DATABASE_URL=${required('DATABASE_URL')}`,
    `BETTER_AUTH_SECRET=${required('BETTER_AUTH_SECRET')}`,
    `PUBLIC_URL=${SPEC.publicUrl}`,
    `MCP_URL=${SPEC.mcpUrl}`,
  ].join('\n')

  const ref = refs.find((c) => c.name === SPEC.service)

  if (!ref) {
    if (DRY_RUN) return planned(`compose ${SPEC.service}`, `create, upload and deploy (${imageTag})`)
    const c = await compose.create({
      name: SPEC.service,
      description: SPEC.serviceDescription,
      environmentId,
      // Not "stack": swarm mode ignores depends_on and reworks published ports.
      composeType: 'docker-compose',
    })
    await compose.update({
      composeId: c.composeId,
      sourceType: 'raw',
      composeFile: wantedFile,
      env: wantedEnv,
    })
    await ensureDomains(c.composeId)
    await compose.deploy(c.composeId)
    return created(`compose ${SPEC.service} (${imageTag}, deployment queued)`)
  }

  const current = await compose.one(ref.composeId)
  const fileDrift = current.composeFile.trim() !== wantedFile.trim()
  const sourceDrift = current.sourceType !== 'raw'
  // Compare as sets of lines: Dokploy may reorder.
  const norm = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort()
      .join('\n')
  const envDrift = norm(current.env ?? '') !== norm(wantedEnv)

  // Domains changed -> Traefik config is only regenerated at deploy time.
  const domainsChanged = await ensureDomains(ref.composeId)

  const status = ref.composeStatus ?? ''
  const neverDeployed = !['done', 'running'].includes(status)

  if (fileDrift || sourceDrift || envDrift) {
    const why = [
      fileDrift && 'compose file',
      envDrift && `environment (${imageTag})`,
      sourceDrift && 'sourceType',
    ]
      .filter(Boolean)
      .join(' + ')
    if (DRY_RUN) return planned(`compose ${SPEC.service}`, `update ${why} and redeploy`)
    await compose.update({
      composeId: ref.composeId,
      sourceType: 'raw',
      composeFile: wantedFile,
      env: wantedEnv,
    })
    await compose.deploy(ref.composeId)
    return updated(`compose ${SPEC.service}`, `${why} changed, redeployed`)
  }

  if (domainsChanged || neverDeployed) {
    const why = domainsChanged ? 'domains changed' : `status was "${status || 'unknown'}"`
    if (DRY_RUN) return planned(`compose ${SPEC.service}`, `deploy (${why})`)
    await compose.deploy(ref.composeId)
    return updated(`compose ${SPEC.service}`, `${why}, deployment queued`)
  }

  same(`compose ${SPEC.service} (${status}, ${imageTag})`)
}

console.log(DRY_RUN ? 'Plan (nothing will be changed)' : 'Provisioning')
console.log(`\n${SPEC.project}`)

const project = await ensureProject()
if (project) {
  const env = findEnvironment(project)
  await ensureCompose(env.compose ?? [], env.environmentId)
} else {
  planned(`compose ${SPEC.service}`, 'create')
}

console.log(
  changes === 0
    ? '\nDeployment matches the spec.'
    : DRY_RUN
      ? `\n${changes} difference(s). Run without --dry-run to apply.`
      : `\n${changes} change(s) applied.`,
)
