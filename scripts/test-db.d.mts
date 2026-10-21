// Types for the TypeScript test helpers that import the guard.
export function assertTestDatabase(url: string): void
export function packageDatabaseUrl(base: string, packageName: string): string
export function prepareTestDatabase(url: string): Promise<void>
export function dropTestDatabases(base: string): Promise<void>
