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

/** Every step a case can take. */
export interface Steps {
  createAccount(input: { name: string; opening?: Money; openedOn?: string }): Promise<void>
  declareExpense(input: { account: string; amount: Money; payee: string; on: string }): Promise<void>
  readAccountBalance(account: string): Promise<Money>
}

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
