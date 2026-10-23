import { after, describe, test } from 'node:test'
import type { CaseUser, Driver, DriverSession, Steps } from '@abacus/use-case-language'
import { drivers, preparationDriver } from './drivers.ts'
import { newUser } from './environment/accounts.ts'
import { gestures, offers } from './inventory/index.ts'

/**
 * Plays a use case on one driver.
 *
 * Each play gets a user of its own, so no case sees another's data, whatever
 * the order or the repetition. The starting state is built by the preparation
 * driver, which goes through the back; what the case is about goes through the
 * driver under test. A step that driver lacks fails the case
 * (`step_not_implemented`), and a step it fails names the case, the step and
 * the driver, with the interface's own words.
 */

export interface UseCase {
  id: string
  body(context: { arrange: Steps; act: Steps }): Promise<void>
}

export interface Players {
  preparation: Driver
  newUser(): Promise<CaseUser>
}

class StepNotImplemented extends Error {
  code = 'step_not_implemented'
}

function guarded(caseId: string, driver: string, steps: Partial<Steps>): Steps {
  return new Proxy({} as Steps, {
    get(_target, step: string) {
      const run = steps[step as keyof Steps] as ((...args: unknown[]) => Promise<unknown>) | undefined
      if (!run)
        throw new StepNotImplemented(
          `step_not_implemented: case ${caseId}, step ${step}, driver ${driver} does not implement it`,
        )
      return async (...args: unknown[]) => {
        try {
          return await run(...args)
        } catch (error) {
          throw new Error(`case ${caseId}, step ${step}, driver ${driver}: ${(error as Error).message}`, {
            cause: error,
          })
        }
      }
    },
  })
}

export async function playCase(useCase: UseCase, driver: Driver, players: Players): Promise<void> {
  const user = await players.newUser()
  const preparation = await players.preparation.open(user)
  let session: DriverSession | undefined
  try {
    session = await driver.open(user)
    await useCase.body({
      arrange: guarded(useCase.id, players.preparation.name, preparation.steps),
      act: guarded(useCase.id, driver.name, session.steps),
    })
  } catch (error) {
    if (error instanceof StepNotImplemented) throw error
    const message = (error as Error).message
    if (message.startsWith(`case ${useCase.id}`)) throw error
    throw new Error(`case ${useCase.id}, driver ${driver.name}: ${message}`, { cause: error })
  } finally {
    await session?.close()
    await preparation.close()
  }
}

export interface CaseOptions {
  /** The gesture the case is about, when some interface does not offer it: played only where it is offered. */
  gesture?: string
  /**
   * Why the case is unstable by construction, when it is: it is still played,
   * and its failure is reported with this reason without failing the run. A
   * flaky case is fixed, not marked; nothing is ever played twice.
   */
  unstable?: string
}

class UnstableWithoutReason extends Error {
  code = 'unstable_without_reason'
}

/** What node:test is told about a case's tests: an unstable one runs as a todo carrying its reason. */
export function caseTestOptions(id: string, options: CaseOptions): { todo?: string } {
  if (options.unstable === undefined) return {}
  if (!options.unstable.trim())
    throw new UnstableWithoutReason(`unstable_without_reason: case ${id} is marked unstable without a reason`)
  return { todo: `unstable: ${options.unstable}` }
}

/**
 * The drivers a case is played on, among those declared: all of them, or, for a
 * case about a gesture, each one the inventory does not give a reason for not
 * offering it. A driver the inventory says nothing of plays it too.
 */
export function playedOn<D extends { name: string }>(options: CaseOptions, declared: D[]): D[] {
  const entry = options.gesture === undefined ? undefined : gestures[options.gesture]
  return declared.filter((d) => offers(entry, d.name))
}

/**
 * Declares a use case, played as one test per declared driver. Called only from
 * a file under cases/, one case per file. A case about a gesture some interface
 * does not offer names it: it is then played only where the inventory says the
 * gesture is offered, the others giving their reason there.
 */
export function useCase(id: string, body: UseCase['body'], options: CaseOptions = {}): void {
  const declared = drivers()
  const testOptions = caseTestOptions(id, options)
  if (options.gesture !== undefined && !gestures[options.gesture])
    throw new Error(`${id}: no gesture ${options.gesture} in the inventory`)
  describe(id, () => {
    for (const driver of playedOn(options, declared))
      test(driver.name, testOptions, () =>
        playCase({ id, body }, driver, { preparation: preparationDriver(), newUser }),
      )
    after(async () => {
      for (const driver of [...declared, preparationDriver()]) await driver.shutdown?.()
    })
  })
}
