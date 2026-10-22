/**
 * The language use cases are written in, and the contract a driver implements.
 *
 * A case says what a person does and what they get, in the domain's words:
 * no screen, no tool name, no table, no function of the back. Only drivers
 * know an interface. The steps form a closed set: a driver implements each
 * one, and a step it lacks fails the case (`step_not_implemented`), it is
 * never skipped.
 *
 * Things are named the way the person names them (an account by its name), so
 * the same case reads the same on every interface.
 */

import type { AccountsSteps } from './steps/accounts.ts'
import type { AdvancesSteps } from './steps/advances.ts'
import type { BusinessSteps } from './steps/business.ts'
import type { CatalogSteps } from './steps/catalog.ts'
import type { CommitmentsSteps } from './steps/commitments.ts'
import type { IdentitySteps } from './steps/identity.ts'
import type { InvestmentsSteps } from './steps/investments.ts'
import type { LedgerSteps } from './steps/ledger.ts'
import type { ReportingSteps } from './steps/reporting.ts'

/** An amount as the domain writes it: a decimal string and its currency, never a float. */
export interface Money {
  amount: string
  currency: string
}

export function eur(amount: string): Money {
  return { amount, currency: 'EUR' }
}

/** The person a case plays as: a user of its own, created for that case alone. */
export interface CaseUser {
  id: string
  email: string
  password: string
  /** The session cookie the sign-up returned, as a `Cookie` header value. */
  cookie: string
  /** An access token to the MCP server, obtained through its OAuth flow. */
  accessToken: string
}

/** Every step a case can take, one file per domain under steps/. */
export interface Steps
  extends LedgerSteps,
    AccountsSteps,
    CommitmentsSteps,
    AdvancesSteps,
    BusinessSteps,
    InvestmentsSteps,
    CatalogSteps,
    ReportingSteps,
    IdentitySteps {}

export type StepName = keyof Steps

/** What a driver opened for one user: the steps it knows, and how to let go. */
export interface DriverSession {
  steps: Partial<Steps>
  close(): Promise<void>
}

/** Turns steps into gestures on one interface. */
export interface Driver {
  name: string
  open(user: CaseUser): Promise<DriverSession>
  /** Lets go of what the driver holds for its whole process: a browser, a pool. */
  shutdown?(): Promise<void>
}

/** What a driver under test exercised: a gesture or a read of the inventory, as its interface names it. */
export interface Exercised {
  driver: string
  /** The web's server action or screen, the MCP tool. */
  name: string
  /** The value of the MCP tool's `action` field, when it has one. */
  action?: string
}

/**
 * Notes what a driver really called, for the coverage guards read at the end
 * of the suite. One line per call, in a file per process, under the folder the
 * suite names; nothing outside the suite.
 */
export async function recordExercised(entry: Exercised): Promise<void> {
  const folder = process.env.ABACUS_CASES_EXERCISED
  if (!folder) return
  const { appendFile } = await import('node:fs/promises')
  await appendFile(`${folder}/${process.pid}.jsonl`, `${JSON.stringify(entry)}\n`)
}

export type * from './steps/catalog.ts'
export type * from './steps/investments.ts'
export type * from './steps/reporting.ts'

/**
 * Whether a refusal of the MCP server tells its client where to sign in: a 401
 * whose challenge names the protected resource's metadata, which names the
 * authorization server to go to.
 */
export async function directsToSignIn(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  const metadata = /resource_metadata="([^"]+)"/.exec(response.headers.get('www-authenticate') ?? '')?.[1]
  if (!metadata) return false
  const document = (await (await fetch(metadata)).json()) as { authorization_servers?: string[] }
  return (document.authorization_servers ?? []).length > 0
}
