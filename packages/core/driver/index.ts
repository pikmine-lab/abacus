import type { Driver, Steps } from '@abacus/use-case-language'
import { closeDb } from '../src/db/client.ts'
import { accountsSteps } from './accounts.ts'
import { advancesSteps } from './advances.ts'
import { balanceHistorySteps } from './balance-history.ts'
import { businessSteps } from './business.ts'
import { catalogSteps } from './catalog.ts'
import { commitmentsSteps } from './commitments.ts'
import { preparationContext } from './context.ts'
import { identitySteps } from './identity.ts'
import { investmentsSteps } from './investments.ts'
import { ledgerSteps } from './ledger.ts'
import { reportingSteps } from './reporting.ts'
import { venuesSteps } from './venues.ts'

/**
 * The preparation driver: builds the starting state of a case through the
 * services of the back, as the demo seed does, never through an interface
 * under test nor straight into the tables. When a gesture moves to the API
 * (#192), its step here calls the API instead, and no case changes. It also
 * plays every step, so a case can be checked against the back alone.
 */
export const preparationDriver: Driver = {
  name: 'preparation',
  async open(user) {
    const ctx = preparationContext(user)
    const steps: Partial<Steps> = {
      ...ledgerSteps(ctx),
      ...accountsSteps(ctx),
      ...balanceHistorySteps(ctx),
      ...commitmentsSteps(ctx),
      ...advancesSteps(ctx),
      ...businessSteps(ctx),
      ...investmentsSteps(ctx),
      ...venuesSteps(ctx),
      ...catalogSteps(ctx),
      ...reportingSteps(ctx),
      ...identitySteps(ctx),
    }
    return { steps, close: async () => {} }
  },
  shutdown: closeDb,
}
