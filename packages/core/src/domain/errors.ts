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
