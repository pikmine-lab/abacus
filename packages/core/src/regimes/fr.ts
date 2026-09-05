/**
 * France, micro-entreprise. Reference data, not code: every figure below is
 * copied from the text named in its `source`, read on 2026-09-04. Changing a
 * rate is an edit to this file and nothing else.
 *
 * What this model deliberately leaves out, because no text read settles it:
 * the chamber-of-commerce and chamber-of-trades levies (their rate depends on
 * being registered as a craft business and on the department), and the tourist
 * accommodation category of D613-4 (its allowance and its flat-rate income tax
 * are not fixed by the texts read).
 */

/** Declared to the Urssaf monthly or quarterly, the user's own choice (CSS R613-8). */
const URSSAF_PERIOD = {
  question: 'declaration_period',
  cases: { month: 'month', quarter: 'quarter' },
} as const

const URSSAF_DUE = {
  question: 'declaration_period',
  cases: {
    month: { type: 'end_of_next_month' },
    quarter: {
      type: 'fixed_dates',
      dates: [
        { month: 4, day: 30 },
        { month: 7, day: 31 },
        { month: 10, day: 31 },
        { month: 1, day: 31, yearOffset: 1 },
      ],
    },
  },
} as const

const SOCIAL_SOURCE = {
  url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000052218738',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

/** CSS D613-4, in force since 2026-01-01 (decree 2025-943 of 8 September 2025). */
const SOCIAL_LEVY = {
  name: 'Cotisations sociales',
  settlementCategory: 'Cotisations sociales',
  kind: 'social',
  validFrom: '2026-01-01',
  source: SOCIAL_SOURCE,
  baseMeasure: 'revenue',
  basePeriodRef: 'current',
  amountForm: 'rate',
  rate: {
    question: 'activity_nature',
    cases: { sale: 12.3, services_bic: 21.2, liberal_bnc: 25.6, liberal_cipav: 23.2 },
  },
  period: URSSAF_PERIOD,
  due: URSSAF_DUE,
  firstDueAfterDays: 90,
  note: "Assises sur le chiffre d'affaires hors taxes encaissé sur la période, déclaré à l'Urssaf même lorsqu'il est nul. La première déclaration ne peut pas intervenir moins de 90 jours après le début de l'activité.",
  modifiers: [
    {
      when: { acre: ['yes'] },
      label:
        "Acre : 75 % du taux, pour les activités créées à compter du 1er juillet 2026, jusqu'à la fin du 3e trimestre civil suivant celui du début d'activité",
      effect: 'rate_factor',
      value: 0.75,
      durationPeriods: { question: 'declaration_period', cases: { month: 12, quarter: 4 } },
      condition:
        "Vous remplissez une des conditions de l'Acre (demandeur d'emploi, bénéficiaire de minima sociaux, moins de 30 ans, quartier prioritaire, zone France ruralités revitalisation) et vous n'en avez pas bénéficié dans les trois années précédentes.",
      source: {
        url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053449085',
        verifiedOn: '2026-09-04',
        reviewOn: '2027-01-01',
        status: 'confirmed',
      },
    },
  ],
} as const

/** Code du travail L6331-48. */
const TRAINING_LEVY = {
  name: 'Contribution à la formation professionnelle',
  settlementCategory: 'Formation professionnelle',
  kind: 'other',
  validFrom: '2026-01-01',
  source: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044056633',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
  baseMeasure: 'revenue',
  basePeriodRef: 'current',
  amountForm: 'rate',
  rate: {
    question: 'activity_nature',
    cases: { sale: 0.1, services_bic: 0.2, liberal_bnc: 0.2, liberal_cipav: 0.2 },
  },
  period: URSSAF_PERIOD,
  due: URSSAF_DUE,
  firstDueAfterDays: 90,
  note: "Réglée à l'Urssaf avec les cotisations, sur le même chiffre d'affaires. Le taux est de 0,3 % pour une activité immatriculée au registre national des entreprises comme entreprise du secteur des métiers et de l'artisanat : corrigez-le si c'est votre cas.",
} as const

/** CGI 1647 D and service-public F23547: an amount only the notice states. */
const CFE_LEVY = {
  name: 'Cotisation foncière des entreprises',
  settlementCategory: 'Impôts locaux',
  kind: 'other',
  validFrom: '2026-01-01',
  source: {
    url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23547',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'unconfirmed',
  },
  baseMeasure: 'none',
  amountForm: 'fixed',
  fixedInputName: 'cfe_notice_amount',
  period: 'year',
  due: { type: 'fixed_dates', dates: [{ month: 12, day: 15 }] },
  note: "Aucun texte n'en fixe le montant : la commune arrête la base minimum dans une fourchette et vote le taux. Reportez le montant de votre avis. Elle n'est pas due l'année de la création, et la cotisation minimum est exonérée quand le chiffre d'affaires de l'avant-dernière année ne dépasse pas 5 000 €. Un acompte de 50 % est exigible le 15 juin quand la cotisation de l'année précédente dépasse 3 000 €.",
} as const

/** BOFiP BOI-TVA-DECLA and service-public F23566, once the franchise is left. */
const VAT_LEVY = {
  when: { vat: ['charged'] },
  name: 'TVA',
  settlementCategory: 'TVA',
  kind: 'vat',
  validFrom: '2026-01-01',
  source: {
    url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23566',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'unconfirmed',
  },
  baseMeasure: 'vat_balance',
  basePeriodRef: 'current',
  amountForm: 'rate',
  rate: 100,
  period: 'month',
  due: { type: 'end_of_next_month' },
  passThrough: true,
  note: "Régime réel normal : déclaration CA3 mensuelle, trimestrielle quand la TVA annuelle est inférieure à 4 000 €. Le jour exact de l'échéance est fixé par votre service des impôts, les sources lues ne le donnent pas : corrigez-le une fois votre calendrier connu.",
} as const

const MICRO_THRESHOLD = {
  label: 'Plafond du régime micro',
  measure: 'revenue',
  periodRef: 'year-1',
  comparison: 'lte',
  value: {
    question: 'activity_nature',
    cases: { sale: 203100, services_bic: 83600, liberal_bnc: 83600, liberal_cipav: 83600 },
  },
  consequence:
    'Dépassé deux années civiles consécutives, le régime micro cesse au 1er janvier suivant et le bénéfice se calcule au réel. Un dépassement isolé ne change rien.',
  source: {
    url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F32353',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
} as const

/** CGI 293 B, rewritten by loi 2025-1044 of 3 November 2025. */
const VAT_THRESHOLD_SOURCE = {
  url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000052485808',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

const VAT_THRESHOLDS = [
  {
    when: { vat: ['franchise'] },
    label: "Franchise en base de TVA, chiffre d'affaires de l'année précédente",
    measure: 'revenue',
    periodRef: 'year-1',
    comparison: 'lte',
    value: {
      question: 'activity_nature',
      cases: { sale: 85000, services_bic: 37500, liberal_bnc: 37500, liberal_cipav: 37500 },
    },
    consequence: "Dépassé, la TVA est due à compter du 1er janvier de l'année suivante.",
    source: VAT_THRESHOLD_SOURCE,
  },
  {
    when: { vat: ['franchise'] },
    label: "Franchise en base de TVA, chiffre d'affaires de l'année en cours",
    measure: 'revenue',
    periodRef: 'ytd',
    comparison: 'lte',
    value: {
      question: 'activity_nature',
      cases: { sale: 93500, services_bic: 41250, liberal_bnc: 41250, liberal_cipav: 41250 },
    },
    consequence:
      'Dépassé, la franchise cesse à la date du dépassement : la TVA est due sur les opérations réalisées à compter de ce jour.',
    source: VAT_THRESHOLD_SOURCE,
  },
] as const

const CFE_THRESHOLD = {
  label: 'Exonération de la cotisation minimum de CFE',
  measure: 'revenue',
  periodRef: 'year-2',
  comparison: 'lte',
  value: 5000,
  consequence:
    'Au-delà, la cotisation minimum de cotisation foncière des entreprises est due, et avec elle la taxe pour frais de chambre de métiers.',
  source: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054373077',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
} as const

const CFE_INPUT = {
  name: 'cfe_notice_amount',
  validFrom: '2026-01-01',
  value: 0,
  note: "Le montant de votre avis de cotisation foncière des entreprises. Zéro l'année de la création, où elle n'est pas due.",
} as const

const ACTIVITY_DEFAULTS = {
  revenueBasis: 'cash',
  fiscalYearStartMonth: 1,
  fiscalYearStartDay: 1,
  vatRegistered: { question: 'vat', cases: { franchise: false, charged: true } },
  defaultVatRate: {
    question: 'vat_rate',
    cases: { standard: 20, intermediate: 10, reduced: 5.5, special: 2.1 },
  },
  deductibleExpenses: 'none',
  currency: 'EUR',
} as const

const MICRO_SOURCE = {
  url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23267',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

export const FR = {
  id: 'fr',
  name: 'France',
  description:
    "Micro-entreprise : cotisations sociales sur le chiffre d'affaires encaissé, impôt au barème ou par versement libératoire, franchise en base de TVA. Règles lues aux textes le 4 septembre 2026.",
  questions: [
    {
      id: 'activity_nature',
      label: 'Quelle est la nature de votre activité ?',
      help: "La catégorie sous laquelle l'activité a été déclarée. Elle fixe le taux des cotisations, l'abattement de l'impôt et les plafonds.",
      options: [
        { value: 'sale', label: 'Vente de marchandises ou fourniture de logement' },
        { value: 'services_bic', label: 'Prestations de services commerciales ou artisanales (BIC)' },
        { value: 'liberal_bnc', label: 'Profession libérale non réglementée (BNC)' },
        {
          value: 'liberal_cipav',
          label: 'Profession libérale relevant de la Cipav',
          help: 'Architectes, géomètres, ingénieurs-conseils, moniteurs de ski et les autres professions listées par le code de la sécurité sociale.',
        },
      ],
    },
    {
      id: 'income_tax',
      label: "Comment payez-vous l'impôt sur le revenu de cette activité ?",
      help: "Le versement libératoire se demande à l'Urssaf, sous condition de revenu fiscal de référence. Sans lui, le bénéfice s'ajoute aux revenus du foyer et suit le barème.",
      options: [
        { value: 'flat', label: 'Par le versement libératoire, avec les cotisations' },
        { value: 'scale', label: 'Au barème, avec le reste de mes revenus' },
      ],
    },
    {
      id: 'declaration_period',
      label: "À quelle fréquence déclarez-vous votre chiffre d'affaires à l'Urssaf ?",
      help: 'Le choix est fait à la création et reconduit chaque année.',
      options: [
        { value: 'month', label: 'Tous les mois' },
        { value: 'quarter', label: 'Tous les trimestres' },
      ],
    },
    {
      id: 'vat',
      label: 'Facturez-vous la TVA ?',
      help: 'En dessous des seuils de la franchise en base, une micro-entreprise ne la facture pas et ne la déduit pas.',
      options: [
        { value: 'franchise', label: 'Non, je suis en franchise en base' },
        { value: 'charged', label: 'Oui, je la facture' },
      ],
    },
    {
      id: 'vat_rate',
      label: 'À quel taux facturez-vous la TVA ?',
      help: "Le taux normal s'applique à toute opération qui ne relève pas expressément d'un autre taux.",
      when: { vat: ['charged'] },
      options: [
        { value: 'standard', label: 'Taux normal, 20 %' },
        { value: 'intermediate', label: 'Taux réduit, 10 %' },
        { value: 'reduced', label: 'Taux réduit, 5,5 %' },
        { value: 'special', label: 'Taux particulier, 2,1 %' },
      ],
    },
    {
      id: 'acre',
      label: "Bénéficiez-vous de l'Acre sur cette activité ?",
      help: "L'exonération de début d'activité, demandée à l'Urssaf dans les 60 jours suivant la création.",
      options: [
        { value: 'yes', label: 'Oui' },
        { value: 'no', label: 'Non' },
      ],
    },
  ],
  models: [
    {
      id: 'fr-micro-flat',
      name: 'Micro-entreprise, versement libératoire',
      description:
        "L'impôt sur le revenu est un pourcentage du chiffre d'affaires, versé à l'Urssaf avec les cotisations. Il libère l'activité de l'impôt et dispense de l'acompte de prélèvement à la source sur ces recettes.",
      when: { income_tax: ['flat'] },
      source: MICRO_SOURCE,
      activity: ACTIVITY_DEFAULTS,
      levies: [
        SOCIAL_LEVY,
        {
          name: "Versement libératoire de l'impôt sur le revenu",
          settlementCategory: 'Impôt sur le revenu',
          kind: 'income_tax',
          validFrom: '2026-01-01',
          source: {
            url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051765182',
            verifiedOn: '2026-09-04',
            reviewOn: '2027-01-01',
            status: 'confirmed',
          },
          baseMeasure: 'revenue',
          basePeriodRef: 'current',
          amountForm: 'rate',
          rate: {
            question: 'activity_nature',
            cases: { sale: 1, services_bic: 1.7, liberal_bnc: 2.2, liberal_cipav: 2.2 },
          },
          period: URSSAF_PERIOD,
          due: URSSAF_DUE,
          firstDueAfterDays: 90,
          note: "Versé avec les cotisations, sur le chiffre d'affaires hors taxes de la période. L'option cesse la deuxième année civile suivant celle où le revenu fiscal de référence du foyer dépasse la limite de la deuxième tranche du barème.",
        },
        TRAINING_LEVY,
        CFE_LEVY,
        VAT_LEVY,
      ],
      thresholds: [MICRO_THRESHOLD, ...VAT_THRESHOLDS, CFE_THRESHOLD],
      inputs: [CFE_INPUT],
    },
    {
      id: 'fr-micro-scale',
      name: 'Micro-entreprise, impôt au barème',
      description:
        "Le bénéfice imposable est le chiffre d'affaires diminué d'un abattement forfaitaire, porté sur la 2042 C PRO et imposé au barème avec le reste des revenus du foyer. En cours d'année, l'administration prélève un acompte qu'elle calcule elle-même.",
      when: { income_tax: ['scale'] },
      source: MICRO_SOURCE,
      activity: ACTIVITY_DEFAULTS,
      levies: [
        SOCIAL_LEVY,
        {
          name: 'Acompte de prélèvement à la source',
          settlementCategory: 'Impôt sur le revenu',
          kind: 'income_tax',
          validFrom: '2026-01-01',
          source: {
            url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23267',
            verifiedOn: '2026-09-04',
            reviewOn: '2027-01-01',
            status: 'unconfirmed',
          },
          baseMeasure: 'none',
          amountForm: 'fixed',
          fixedInputName: 'income_tax_instalment',
          period: 'month',
          due: { type: 'end_of_next_month' },
          note: "Aucun texte n'en fixe le montant depuis la seule activité : l'administration le calcule sur l'ensemble des revenus du foyer et de ses parts. Reportez le montant prélevé. Le bénéfice imposable est le chiffre d'affaires diminué de l'abattement forfaitaire (71 % en vente, 50 % en prestations BIC, 34 % en libéral), sans que l'abattement puisse être inférieur à 305 €.",
        },
        TRAINING_LEVY,
        CFE_LEVY,
        VAT_LEVY,
      ],
      thresholds: [MICRO_THRESHOLD, ...VAT_THRESHOLDS, CFE_THRESHOLD],
      inputs: [
        CFE_INPUT,
        {
          name: 'income_tax_instalment',
          validFrom: '2026-01-01',
          value: 0,
          note: "Le montant de l'acompte de prélèvement à la source prélevé au titre de cette activité, tel qu'il figure sur votre espace impots.gouv.",
        },
      ],
    },
  ],
}
