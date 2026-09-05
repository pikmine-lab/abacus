/**
 * The words the levy vocabulary takes on screen. A rule's own name, its
 * regime label and its threshold sentences come from what the user declared;
 * what is left here are the enums of the model, which need a French word each
 * and need the same one wherever they show, in Réglages as in the statement.
 *
 * Typed loosely on purpose: the rows these label arrive from the database as
 * plain strings, and narrowing them at every call site would buy nothing.
 */

export const LEVY_KIND_LABEL: Record<string, string> = {
  social: 'Cotisations sociales',
  income_tax: 'Impôt sur le revenu',
  vat: 'TVA',
  other: 'Autre',
}

export const LEVY_MEASURE_LABEL: Record<string, string> = {
  revenue: 'recettes HT',
  revenue_incl_vat: 'recettes TTC',
  expenses: 'dépenses déductibles',
  profit: 'bénéfice',
  vat_balance: 'TVA collectée − déductible',
  withholdings: 'retenues à la source',
  withholding_share: 'part des recettes retenues',
  paid: 'règlements d’une autre règle',
  amount: 'montant d’une autre règle',
  input: 'paramètre saisi',
  none: 'aucune base',
}

export const LEVY_PERIOD_REF_LABEL: Record<string, string> = {
  current: 'la période',
  ytd: 'l’exercice en cours',
  'year-1': 'l’exercice n−1',
  'year-2': 'l’exercice n−2',
  'rolling-12': '12 mois glissants',
}

export const LEVY_PERIOD_LABEL: Record<string, string> = {
  month: 'mensuelle',
  quarter: 'trimestrielle',
  half: 'semestrielle',
  year: 'annuelle',
}

export const LEVY_EFFECT_LABEL: Record<string, string> = {
  rate_factor: 'facteur sur le taux',
  replace_amount: 'montant de remplacement',
  coefficient: 'coefficient sur la base',
  exempt: 'exonération',
}

/** Only what is not plainly confirmed gets a badge: a confirmed rule says nothing. */
export const LEVY_STATUS_BADGE: Record<string, { label: string; variant: 'secondary' | 'outline' }> = {
  extended_by_default: { label: 'prorogée', variant: 'secondary' },
  unconfirmed: { label: 'non confirmée', variant: 'outline' },
}
