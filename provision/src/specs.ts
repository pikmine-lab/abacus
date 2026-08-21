/**
 * Declarative description of the abacus deployment. This file is the source of
 * truth: `provision.ts` reconciles Dokploy against it, never the other way
 * around.
 *
 * The image tag is NOT written here: continuous deployment passes it as
 * IMAGE_TAG (always an immutable `sha-…` tag, never `latest`), and the
 * provisioner compares it with what Dokploy currently runs. Rolling back is
 * re-running the provisioner with an earlier tag.
 */
export const SPEC = {
  project: 'abacus',
  projectDescription: 'Personal finance app (abacus): web UI and MCP server over the shared Postgres.',
  service: 'abacus',
  serviceDescription: 'abacus web (Next.js) + MCP server. Images from GHCR, deployed on every main commit.',
  /** Compose file, relative to the repository root. */
  composeFile: 'deploy/docker-compose.yml',
  publicUrl: 'https://abacus.payangar.dev',
  /** Endpoint the web app hands out on the "brancher une IA" screen. */
  mcpUrl: 'https://abacus-mcp.payangar.dev/mcp',
  domains: [
    { host: 'abacus.payangar.dev', serviceName: 'web', port: 3000 },
    { host: 'abacus-mcp.payangar.dev', serviceName: 'mcp', port: 3000 },
  ],
}
