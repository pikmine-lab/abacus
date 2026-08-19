/**
 * Loads provision/.env for local runs; CI passes everything through the job
 * environment instead. The repository is public, so anything naming a machine
 * (DOKPLOY_URL first of all) stays out of it.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_FILE = resolve(import.meta.dirname, '..', '.env')

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set (provision/.env locally, an environment secret in CI).`)
  return value
}

export function optional(name: string): string {
  return process.env[name]?.trim() ?? ''
}
