import { after, describe, test } from 'node:test'
import type { CaseUser, Driver, Steps } from '@abacus/use-case-language'
import { drivers, preparationDriver } from './drivers.ts'
import { newUser } from './environment/accounts.ts'

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
  const session = await driver.open(user)
  try {
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
    await session.close()
    await preparation.close()
  }
}

/**
 * Declares a use case, played as one test per declared driver. Called only from
 * a file under cases/, one case per file.
 */
export function useCase(id: string, body: UseCase['body']): void {
  const declared = drivers()
  describe(id, () => {
    for (const driver of declared)
      test(driver.name, () => playCase({ id, body }, driver, { preparation: preparationDriver, newUser }))
    after(async () => {
      for (const driver of [...declared, preparationDriver]) await driver.shutdown?.()
    })
  })
}
