/**
 * Declarative description of the abacus deployment: the only file to edit.
 * `provision.ts` reconciles Dokploy against it, never the other way around.
 *
 * The image tag is not written here: the CI passes it as IMAGE_TAG, an
 * immutable `sha-…` tag. Rolling back is re-running the provisioner with an
 * earlier tag.
 */

/** A secret handed to the deployment, read from the vault in CI. */
export type SecretRef = {
  /** Variable name, as the compose file (or this provisioner) reads it. */
  name: string
  /** Vault project and folder where it lives (see the platform doctrine). */
  project: string
  path: string
  /** Key in the vault, when it differs from `name`. */
  key?: string
  /**
   * 'compose' (default): passed to the containers through the compose
   * environment. 'ci': read by this provisioner only, never passed on.
   */
  for?: 'compose' | 'ci'
}

export const SPEC = {
  /** Dokploy project and compose service, one of each per application. */
  project: 'abacus',
  projectDescription: 'Personal finance app (abacus): web UI and MCP server over the shared Postgres.',
  service: 'abacus',
  serviceDescription: 'abacus web (Next.js) + MCP server. Images from GHCR, deployed on every main commit.',
  /** Compose file, relative to the repository root. */
  composeFile: 'deploy/docker-compose.yml',

  /** Public hosts, each routed to a service of the compose file and its port. */
  domains: [
    { host: 'abacus.payangar.dev', serviceName: 'web', port: 3000 },
    { host: 'abacus-mcp.payangar.dev', serviceName: 'mcp', port: 3000 },
  ],

  /** Non-secret variables passed to the containers, written here in clear. */
  env: {
    PUBLIC_URL: 'https://abacus.payangar.dev',
    /** Endpoint the web app hands out on the "brancher une IA" screen. */
    MCP_URL: 'https://abacus-mcp.payangar.dev/mcp',
  } as Record<string, string>,

  /**
   * Secrets passed to the deployment. Locally they are read from provision/.env
   * by name. /infra holds what the platform hands abacus and keeps in line with
   * the database role; /app holds abacus's own.
   */
  secrets: [
    { name: 'DATABASE_URL', project: 'abacus', path: '/infra' },
    { name: 'BETTER_AUTH_SECRET', project: 'abacus', path: '/app' },
  ] as SecretRef[],

  vault: {
    /** Vault address, from the platform doctrine. */
    url: 'https://vault.np4.dev',
    /** OIDC audience bound on this repository's vault identity. */
    audience: 'https://github.com/pikmine-lab',
  },
}
