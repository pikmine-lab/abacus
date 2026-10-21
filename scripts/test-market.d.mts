// Types for the TypeScript code that starts the local market.
export function startMarket(): Promise<{ url: string; close(): Promise<void> }>
export function globalSetup(): Promise<void>
export function globalTeardown(): Promise<void>
