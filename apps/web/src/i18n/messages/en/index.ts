import type { Messages } from '../fr'
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

/** The English catalog, held to the French one's shape. */
export default {
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
} satisfies Messages
