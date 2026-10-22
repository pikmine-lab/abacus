/**
 * What each interface offers: every gesture (at the action level) and every
 * information (at the data level), and for each declared interface what offers
 * it, or why that interface does not. Interfaces are not written in by hand
 * anywhere else: an entry is keyed by the name of the driver that plays it.
 *
 * What offers an entry is named as the driver notes it when it exercises it:
 * a web server action or `screen:<route>` (a dynamic segment kept as written,
 * `[cardId]`), an MCP tool or `tool · action`. The guards compare this file to
 * the interfaces themselves (inventory_out_of_date), to the declared drivers
 * (interface_missing_without_reason) and, at the end of a full run, to what
 * the drivers really called (gesture_not_covered, mcp_tool_not_covered).
 *
 * One difference is kept on purpose, beside the entries: an actor nobody
 * declared yet is created on the spot by the web, where a person typed the name
 * and means it, and refused by the MCP unless the call asks for it
 * (`createUnknownActors`), since an AI may misspell a name and so make a
 * duplicate. Both offer the gesture; only the default differs.
 */

export interface Missing {
  missingReason: string
}

export type Offering = string | string[] | Missing

export type Entry = Record<string, Offering>

const PROTOCOL =
  'Signing up, signing in and consenting are web pages by construction of OAuth: an MCP client opens them in the browser, then holds a token.'
const NO_SESSION =
  'An MCP client holds a token, not a session: it has nothing to sign out of, and cutting its access is revoking its connection.'

export const gestures: Record<string, Entry> = {
  'auth.sign-up': { web: 'screen:/login', mcp: { missingReason: PROTOCOL } },
  'auth.sign-in': { web: 'screen:/login', mcp: { missingReason: PROTOCOL } },
  'auth.sign-out': { web: 'screen:/', mcp: { missingReason: NO_SESSION } },
  'auth.consent': { web: 'screen:/consent', mcp: { missingReason: PROTOCOL } },
  'connection.revoke': { web: 'revokeAuthorizationAction', mcp: 'manage_connections · revoke' },

  'movement.declare': { web: 'declareMovementAction', mcp: 'declare_movements' },
  'movement.correct': { web: 'correctMovementAction', mcp: 'fix_movement · correct' },
  'movement.delete': { web: 'deleteMovementAction', mcp: 'fix_movement · delete' },
  'refund.unlink': { web: 'unlinkRefundAction', mcp: 'fix_movement · correct' },

  'share.remove': { web: 'removeShareAction', mcp: 'manage_claims · remove' },
  'share.plan': { web: 'planShareAction', mcp: 'manage_claims · plan' },
  'share.drop-plan': { web: 'planShareAction', mcp: 'manage_claims · drop_plan' },
  'share.refund': { web: 'refundShareAction', mcp: 'declare_movements' },
  'share.close': { web: 'closeShareAction', mcp: 'close_advance' },

  'balance-check.record': { web: 'recordBalanceCheckAction', mcp: 'record_balance_check' },
  'balance-check.correct': { web: 'correctBalanceCheckAction', mcp: 'manage_balance_checks · correct' },
  'balance-check.delete': { web: 'deleteBalanceCheckAction', mcp: 'manage_balance_checks · delete' },
  'check-gap.settle': { web: 'settleCheckGapAction', mcp: 'settle_check_gap' },

  'account.create': { web: 'createAccountAction', mcp: 'manage_accounts · create' },
  'account.edit': { web: 'editAccountAction', mcp: 'manage_accounts · update' },
  'account.close': { web: 'closeAccountAction', mcp: 'manage_accounts · close' },
  'account.reopen': { web: 'reopenAccountAction', mcp: 'manage_accounts · reopen' },

  'card.create': { web: 'createCardAction', mcp: 'manage_cards · create' },
  'card.edit': { web: 'editCardAction', mcp: 'manage_cards · update' },
  'card.delete': { web: 'deleteCardAction', mcp: 'manage_cards · delete' },
  'card-statement.validate': { web: 'confirmStatementAction', mcp: 'manage_card_statements · validate' },
  'card-statement.undo': { web: 'undoStatementAction', mcp: 'manage_card_statements · undo' },

  'subscription.create': { web: 'createSubscriptionAction', mcp: 'manage_subscription · create' },
  'subscription.judge': { web: 'setJudgmentAction', mcp: 'manage_subscription · set_judgment' },
  'investment-plan.create': { web: 'createInvestmentPlanAction', mcp: 'manage_investment_plan · create' },
  'financing.create': { web: 'createFinancingAction', mcp: 'declare_financing' },
  'financing.revise-schedule': { web: 'reviseScheduleAction', mcp: 'manage_financing_schedule · revise' },
  'occurrence.confirm': { web: 'confirmOccurrenceAction', mcp: 'confirm_due_movements' },
  'occurrence.skip': { web: 'skipOccurrenceAction', mcp: 'confirm_due_movements' },
  'commitment.edit': { web: 'editCommitmentAction', mcp: 'update_commitment' },
  'commitment.change-account': { web: 'changeCommitmentAccountAction', mcp: 'change_commitment_account' },
  'commitment.change-price': {
    web: 'changePriceAction',
    mcp: ['manage_subscription · change_price', 'manage_investment_plan · change_amount'],
  },
  'commitment.cancel': {
    web: 'cancelCommitmentAction',
    mcp: ['manage_subscription · cancel', 'manage_investment_plan · cancel'],
  },

  'invoice.declare': { web: 'declareInvoiceAction', mcp: 'declare_invoices' },
  'invoice.correct': { web: 'correctInvoiceAction', mcp: 'fix_invoice · correct' },
  'invoice.remind': { web: 'remindInvoiceAction', mcp: 'fix_invoice · remind' },
  'invoice.cancel': { web: 'cancelInvoiceAction', mcp: 'fix_invoice · cancel' },
  'invoice.settle': { web: 'settleInvoiceAction', mcp: 'settle_invoice' },
  'nil-return.declare': { web: 'confirmNilReturnAction', mcp: 'confirm_nil_returns' },
  'nil-return.withdraw': { web: 'withdrawNilReturnAction', mcp: 'confirm_nil_returns' },
  'levy.pay': { web: 'confirmLevyPaymentAction', mcp: 'confirm_levy_payment' },
  'levy.create': { web: 'createLevyAction', mcp: 'manage_levies · create' },
  'levy.edit': { web: 'editLevyAction', mcp: 'manage_levies · update' },
  'levy.supersede': { web: 'supersedeLevyAction', mcp: 'manage_levies · supersede' },
  'levy.close': { web: 'closeLevyAction', mcp: 'manage_levies · close' },
  'levy.delete': { web: 'deleteLevyAction', mcp: 'manage_levies · delete' },
  'levy.add-modifier': { web: 'addModifierAction', mcp: 'manage_levies · add_modifier' },
  'levy.remove-modifier': { web: 'removeModifierAction', mcp: 'manage_levies · remove_modifier' },
  'figure.set': { web: 'setInputAction', mcp: 'set_activity_inputs · set' },
  'figure.remove': { web: 'removeInputAction', mcp: 'set_activity_inputs · remove' },
  'threshold.create': { web: 'createThresholdAction', mcp: 'manage_thresholds · create' },
  'threshold.edit': { web: 'editThresholdAction', mcp: 'manage_thresholds · update' },
  'threshold.remove': { web: 'removeThresholdAction', mcp: 'manage_thresholds · remove' },

  'activity.create': { web: 'createActivityAction', mcp: 'manage_activities · create' },
  'activity.edit': { web: 'editActivityAction', mcp: 'manage_activities · update' },
  'activity.close': { web: 'closeActivityAction', mcp: 'manage_activities · close' },
  'activity.reopen': { web: 'reopenActivityAction', mcp: 'manage_activities · reopen' },
  'activity.set-exceptions': {
    web: 'setActivityExceptionsAction',
    mcp: 'manage_activities · set_exceptions',
  },
  'activity.set-accounts': {
    web: ['createActivityAction', 'editActivityAction'],
    mcp: 'manage_activities · set_accounts',
  },
  'regime.browse': {
    web: ['regimeStepAction', 'regimePreviewAction'],
    mcp: ['browse_regimes · jurisdictions', 'browse_regimes · questions', 'browse_regimes · preview'],
  },
  'regime.create-activity': { web: 'createActivityFromRegimeAction', mcp: 'manage_activities · create' },

  'category.create': { web: 'createCategoryAction', mcp: 'manage_categories · create' },
  'category.edit': { web: 'editCategoryAction', mcp: 'manage_categories · update' },
  'actor.create': { web: 'createActorAction', mcp: 'manage_actors · create' },
  'actor.edit': { web: 'editActorAction', mcp: 'manage_actors · update' },
  'actor.merge': { web: 'mergeActorsAction', mcp: 'manage_actors · merge' },
  'actor.add-alias': { web: 'addAliasAction', mcp: 'manage_actors · add_alias' },
  'actor.reattach-history': { web: 'reattachActorHistoryAction', mcp: 'manage_actors · reattach_history' },
  'actor.preview-reattach': { web: 'countReattachableAction', mcp: 'manage_actors · preview_reattach' },

  'preferences.reading': { web: 'setReadingPreferenceAction', mcp: 'manage_preferences · update' },
  'preferences.ranking-view': { web: 'setRankingViewPreferenceAction', mcp: 'manage_preferences · update' },
  'preferences.language': { web: 'setLanguagePreferenceAction', mcp: 'manage_preferences · update' },

  'asset.declare': { web: 'declareAssetAction', mcp: 'manage_assets · create' },
  'asset.rename': { web: 'renameAssetAction', mcp: 'manage_assets · rename' },
  'asset.set-price': { web: 'setAssetPriceAction', mcp: 'manage_assets · set_price' },
  'asset.unfollow': { web: 'stopFollowingAction', mcp: 'manage_assets · unfollow' },
  'operation.record': { web: 'recordOperationAction', mcp: 'record_investment_operations' },
  'operation.correct': { web: 'correctOperationAction', mcp: 'fix_investment_operation · correct' },
  'operation.delete': { web: 'deleteOperationAction', mcp: 'fix_investment_operation · delete' },
}

export const informations: Record<string, Entry> = {
  overview: { web: 'screen:/', mcp: 'get_overview' },
  flows: { web: 'screen:/analysis', mcp: 'analyze_flows' },
  accounts: { web: 'screen:/accounts', mcp: 'manage_accounts · list' },
  'account.daily-balance': { web: 'screen:/', mcp: 'get_balance_history' },
  movements: { web: 'screen:/movements', mcp: 'list_movements' },
  'claims.open': { web: 'screen:/movements', mcp: 'list_outstanding_advances' },
  'balance-checks': { web: 'screen:/accounts', mcp: 'manage_balance_checks · list' },
  cards: { web: 'screen:/accounts', mcp: 'manage_cards · list' },
  'card-statements': { web: 'screen:/accounts/cards/[cardId]', mcp: 'manage_card_statements · list' },
  commitments: {
    web: ['screen:/recurring-expenses', 'screen:/recurring-income', 'screen:/investments'],
    mcp: 'list_commitments',
  },
  'financing.schedule': { web: 'screen:/recurring-expenses', mcp: 'manage_financing_schedule · show' },
  actors: { web: 'screen:/settings', mcp: 'manage_actors · list' },
  categories: { web: 'screen:/settings', mcp: 'manage_categories · list' },
  activities: { web: ['screen:/settings', 'screen:/activity'], mcp: 'manage_activities · list' },
  invoices: { web: 'screen:/activity', mcp: 'list_invoices' },
  'activity.statement': { web: 'screen:/activity', mcp: 'get_activity_statement' },
  levies: { web: 'screen:/settings/activities/[activityId]', mcp: 'manage_levies · list' },
  figures: { web: 'screen:/settings/activities/[activityId]', mcp: 'set_activity_inputs · list' },
  thresholds: { web: 'screen:/settings/activities/[activityId]', mcp: 'manage_thresholds · list' },
  preferences: { web: 'screen:/settings', mcp: 'manage_preferences · show' },
  connections: { web: 'screen:/connect-ai', mcp: 'manage_connections · list' },
  assets: { web: 'screen:/investments', mcp: 'manage_assets · list' },
  'asset.price-history': { web: 'screen:/investments/[assetId]', mcp: 'manage_assets · history' },
  portfolio: { web: 'screen:/investments', mcp: 'get_portfolio' },
  'portfolio.history': { web: 'screen:/investments', mcp: 'get_portfolio_history' },
  operations: {
    web: ['screen:/investments', 'screen:/investments/[assetId]'],
    mcp: 'list_investment_operations',
  },
  'instruments.search': { web: 'screen:/investments', mcp: 'search_instruments' },
  'instrument.venues': { web: 'screen:/investments', mcp: 'list_instrument_venues' },
}

/** Whether a driver's interface offers an entry: false only when the inventory gives it a reason. */
export function offers(entry: Entry | undefined, driver: string): boolean {
  const offering = entry?.[driver]
  return !(offering && typeof offering === 'object' && 'missingReason' in offering)
}

/** What offers an entry on one interface, as a list; empty when it does not offer it. */
export function offeringsOf(entry: Entry, driver: string): string[] {
  const offering = entry[driver]
  if (offering === undefined || (typeof offering === 'object' && 'missingReason' in offering)) return []
  return typeof offering === 'string' ? [offering] : offering
}
