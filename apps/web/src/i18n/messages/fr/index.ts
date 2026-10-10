import accounts from './accounts.json'
import actions from './actions.json'
import activity from './activity.json'
import analysis from './analysis.json'
import auth from './auth.json'
import common from './common.json'
import errors from './errors.json'
import home from './home.json'
import investments from './investments.json'
import movements from './movements.json'
import recurring from './recurring.json'
import regime from './regime.json'
import settings from './settings.json'
import shell from './shell.json'

/**
 * The French catalog, one file per group of screens so that a screen's words
 * sit together. Its shape is the reference every other language must match.
 */
const messages = {
  accounts,
  actions,
  activity,
  analysis,
  auth,
  common,
  errors,
  home,
  investments,
  movements,
  recurring,
  regime,
  settings,
  shell,
}

export type Messages = typeof messages
export default messages
