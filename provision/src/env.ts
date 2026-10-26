/**
 * Loads provision/.env for local runs. In CI every value comes from the vault
 * (vault.ts) or from the job. Keep provision/.env out of git: it holds the same
 * secrets the vault does.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_FILE = resolve(import.meta.dirname, '..', '.env')

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set (provision/.env locally, the vault or the job in CI).`)
  return value
}

export function optional(name: string): string {
  return process.env[name]?.trim() ?? ''
}
