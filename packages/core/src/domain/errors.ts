/**
 * Business rule violation, meant to cross the service boundary. The API and
 * MCP layers map `code` to a message that tells the caller what to do instead;
 * anything else that escapes a service is a bug.
 */
export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

/**
 * Rethrows a PostgreSQL unique violation as the domain rule it broke. The
 * uniqueness of a name is a model constraint, so the caller gets something it
 * can act on instead of a driver error.
 */
export function rethrowUnique(e: unknown, code: string, message: string): never {
  if ((e as { code?: string }).code === '23505') throw new DomainError(code, message)
  throw e
}
