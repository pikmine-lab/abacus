/**
 * Spain, trabajador autónomo taxed on real income. Reference data, not code:
 * every figure below is copied from the text named in its `source`, read on
 * 2026-09-04. Three models, because the tax administration is not the same
 * everywhere: the Concierto Económico gives the Basque provinces their own
 * income tax, their own instalment rules and their own filing dates, while the
 * RETA contribution stays national.
 *
 * What this jurisdiction deliberately leaves out, because no text read settles
 * it: the reducción for a dependent worker (art. 32.2), the instalment
 * minoración for low earnings, and the VAT cash-accounting option.
 */

/** Orden PJC/297/2026 art. 18.1: the 2026 tramos, reduced table then general. */
const RETA_TRAMOS = [
  { upTo: 670, minBase: 653.59, maxBase: 718.94 },
  { upTo: 900, minBase: 718.95, maxBase: 900 },
  { upTo: 1166.7, minBase: 849.67, maxBase: 1166.7 },
  { upTo: 1300, minBase: 950.98, maxBase: 1300 },
  { upTo: 1500, minBase: 960.78, maxBase: 1500 },
  { upTo: 1700, minBase: 960.78, maxBase: 1700 },
  { upTo: 1850, minBase: 1143.79, maxBase: 1850 },
  { upTo: 2030, minBase: 1209.15, maxBase: 2030 },
  { upTo: 2330, minBase: 1274.51, maxBase: 2330 },
  { upTo: 2760, minBase: 1356.21, maxBase: 2760 },
  { upTo: 3190, minBase: 1437.91, maxBase: 3190 },
  { upTo: 3620, minBase: 1519.61, maxBase: 3620 },
  { upTo: 4050, minBase: 1601.31, maxBase: 4050 },
  { upTo: 6000, minBase: 1732.03, maxBase: 5101.2 },
  { upTo: null, minBase: 1928.1, maxBase: 5101.2 },
] as const

/** National, identical in the common territory and in the foral ones. */
const RETA_LEVY = {
  name: 'Cotisation RETA',
  kind: 'social',
  validFrom: '2026-01-01',
  source: {
    url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2026-7296',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
  baseMeasure: 'profit',
  basePeriodRef: 'year',
  baseCoefficient: 0.93,
  baseScale: 'per_month',
  amountForm: 'elective_base',
  elective: { rows: RETA_TRAMOS, inputName: 'reta_base', rate: 31.5 },
  period: 'month',
  due: { type: 'after_period', monthOffset: 0, fromDay: 1, toDay: 31 },
  regularization: 'annual_deadzone',
  regularizationParams: { settleMonthOffset: 12, refundMonthOffset: 16 },
  deductible: true,
  note: "La base mensuelle est celle que vous choisissez auprès de la Seguridad Social ; le tramo de vos rendimientos la borne. Le taux de 31,50 % additionne contingencias comunes (28,30 %), contingencias profesionales (1,30 %), MEI (0,90 %), cese de actividad (0,90 %) et formación profesional (0,10 %). Le rendimiento computable du texte réintègre les cotisations RETA de l'année avant la déduction forfaitaire de 7 % : cette réintégration ne s'exprime pas ici, le tramo lu est donc un peu bas. Le calendrier de prélèvement n'est pas donné par les textes lus, la cuota est réglée dans le mois qu'elle couvre.",
  modifiers: [
    {
      when: { tarifa_plana: ['yes'] },
      label:
        "Cuota reducida de début d'activité (tarifa plana) : 80 € par mois pendant douze mois. Le texte qui fixait ce montant couvrait 2023 à 2025 et aucun texte 2026 ne l'a repris",
      effect: 'replace_amount',
      value: 80,
      durationMonths: 12,
      condition:
        "Alta initiale, ou aucune alta au RETA dans les deux années précédentes (trois si la tarifa plana a déjà été utilisée), demandée au moment de l'alta.",
      source: {
        url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2022-12482',
        verifiedOn: '2026-09-04',
        reviewOn: '2027-01-01',
        status: 'extended_by_default',
      },
    },
  ],
} as const

const RETA_INPUT = {
  name: 'reta_base',
  validFrom: '2026-01-01',
  value: 950.98,
  note: 'La base de cotisation mensuelle choisie auprès de la Seguridad Social. Ici, la base minimale du premier tramo de la table générale 2026. Six changements par an sont possibles, avec effet au 1er mars, 1er mai, 1er juillet, 1er septembre, 1er novembre et 1er janvier.',
} as const

const SIMPLIFIED_CAP = {
  label: 'Plafond de la estimación directa simplificada',
  measure: 'revenue',
  periodRef: 'year-1',
  comparison: 'lte',
  value: 600000,
  consequence:
    "Au-delà, la modalité simplifiée cesse et la modalité normale s'applique, avec ses amortissements et ses provisions réels.",
  source: {
    url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
} as const

const START_REDUCTION_SOURCE = {
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

const ACTIVITY_DEFAULTS = {
  revenueBasis: 'invoiced',
  fiscalYearStartMonth: 1,
  fiscalYearStartDay: 1,
  vatRegistered: true,
  defaultVatRate: 21,
  deductibleExpenses: 'all',
  currency: 'EUR',
} as const

const FORAL_DUE = {
  type: 'fixed_dates',
  dates: [
    { month: 4, day: 25 },
    { month: 7, day: 25 },
    { month: 10, day: 25 },
    { month: 1, day: 25, yearOffset: 1 },
  ],
} as const

const BIZKAIA_IRPF_SOURCE = {
  url: 'https://www.bizkaia.eus/documents/880307/15187815/ca_47_2014.pdf',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

const BIZKAIA_VAT_LEVY = {
  name: 'IVA (modelo 303 foral)',
  kind: 'vat',
  validFrom: '2026-01-01',
  source: {
    url: 'https://www.bizkaia.eus/ogasuna/faq/faq_detalle.asp?Idioma=ca&idregistro=900002779',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
  baseMeasure: 'vat_balance',
  basePeriodRef: 'current',
  amountForm: 'rate',
  rate: 100,
  period: 'quarter',
  due: {
    type: 'fixed_dates',
    dates: [
      { month: 4, day: 25 },
      { month: 7, day: 25 },
      { month: 10, day: 25 },
      { month: 1, day: 31, yearOffset: 1 },
    ],
  },
  passThrough: true,
  note: "Les règles de fond sont nationales, la Hacienda Foral encaisse et fixe ses modelos. Les trois premiers trimestres se déclarent du 1er au 25 du mois suivant ; le quatrième n'a pas de 303, son résultat est porté au modelo annuel 390, déposé du 1er au 31 janvier. Taux général 21 %. Un service rendu à une entreprise établie dans un autre État membre n'est pas soumis à l'IVA espagnole et entre au modelo 349.",
} as const

const BIZKAIA_EXEMPTION_THRESHOLD = {
  label: 'Dispense de paiement fractionné',
  measure: 'withholding_share',
  periodRef: 'year-2',
  comparison: 'gte',
  value: 70,
  consequence:
    "Quand au moins 70 % des recettes de l'avant-dernière année ont supporté une retenue, le modelo 130 foral n'est pas dû.",
  source: BIZKAIA_IRPF_SOURCE,
} as const

const BIZKAIA_SIMPLIFIED_CAP = {
  ...SIMPLIFIED_CAP,
  source: {
    url: 'https://www.bizkaia.eus/documents/880307/15187815/ca_13_2013.pdf',
    verifiedOn: '2026-09-04',
    reviewOn: '2027-01-01',
    status: 'confirmed',
  },
} as const

const BIZKAIA_SOURCE = {
  url: 'https://www.bizkaia.eus/documents/880307/15187815/ca_13_2013.pdf',
  verifiedOn: '2026-09-04',
  reviewOn: '2027-01-01',
  status: 'confirmed',
} as const

export const ES = {
  id: 'es',
  name: 'Espagne',
  description:
    "Trabajador autónomo imposé sur ses revenus réels : cotisation RETA par tramo de rendimientos, paiements fractionnés d'IRPF, IVA trimestrielle. L'administration compétente dépend du lieu de résidence. Règles lues aux textes le 4 septembre 2026.",
  questions: [
    {
      id: 'tax_administration',
      label: 'Quelle administration reçoit votre déclaration de revenus ?',
      help: "Elle dépend de votre résidence habituelle. Au Pays basque, c'est la Diputación forale et non l'AEAT : impôt sur le revenu, paiements fractionnés et modelos y sont propres.",
      options: [
        { value: 'aeat', label: "L'AEAT (territoire commun)" },
        { value: 'bizkaia', label: 'La Hacienda Foral de Bizkaia' },
      ],
    },
    {
      id: 'years_active',
      label: 'Depuis combien de temps exercez-vous cette activité ?',
      help: "À Bizkaia, le paiement fractionné des deux premières années se calcule sur le trimestre courant ; ensuite, il devient un forfait assis sur l'avant-dernière année.",
      when: { tax_administration: ['bizkaia'] },
      options: [
        { value: 'first_two', label: "Première ou deuxième année d'activité" },
        { value: 'later', label: 'Troisième année ou plus' },
      ],
    },
    {
      id: 'tarifa_plana',
      label: "Bénéficiez-vous de la cuota reducida de début d'activité (tarifa plana) ?",
      help: "Elle remplace la cotisation RETA par un montant forfaitaire pendant douze mois, sur demande au moment de l'alta.",
      options: [
        { value: 'yes', label: 'Oui' },
        { value: 'no', label: 'Non' },
      ],
    },
    {
      id: 'start_reduction',
      label: "Appliquez-vous la réduction de début d'activité sur votre résultat ?",
      help: "Elle vaut le premier exercice où le résultat est positif et le suivant, si vous n'exerciez aucune activité l'année précédant le début.",
      options: [
        { value: 'yes', label: 'Oui' },
        { value: 'no', label: 'Non' },
      ],
    },
  ],
  models: [
    {
      id: 'es-aeat',
      name: 'Autónomo, estimación directa simplificada (AEAT)',
      description:
        'Territoire commun : le résultat est la différence entre recettes et dépenses engagées, diminuée de 5 % au titre des gastos de difícil justificación. Paiement fractionné trimestriel de 20 % du résultat, moins les retenues pratiquées par les clients.',
      when: { tax_administration: ['aeat'] },
      source: {
        url: 'https://sede.agenciatributaria.gob.es/Sede/irpf/empresarios-individuales-profesionales/regimenes-determinar-rendimiento-actividad/estimacion-directa-simplificada.html',
        verifiedOn: '2026-09-04',
        reviewOn: '2027-01-01',
        status: 'confirmed',
      },
      activity: ACTIVITY_DEFAULTS,
      levies: [
        RETA_LEVY,
        {
          name: 'Paiement fractionné IRPF (modelo 130)',
          kind: 'income_tax',
          validFrom: '2026-01-01',
          source: {
            url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820',
            verifiedOn: '2026-09-04',
            reviewOn: '2027-01-01',
            status: 'confirmed',
          },
          baseMeasure: 'profit',
          basePeriodRef: 'current',
          baseAbatement: { rate: 5 },
          amountForm: 'rate',
          rate: 20,
          baseCredits: [{ source: 'withholdings', share: 100, periodRef: 'current' }],
          period: 'quarter',
          due: {
            type: 'fixed_dates',
            dates: [
              { month: 4, day: 20 },
              { month: 7, day: 20 },
              { month: 10, day: 20 },
              { month: 1, day: 30, yearOffset: 1 },
            ],
          },
          note: "Le texte calcule 20 % du résultat cumulé depuis le 1er janvier, moins les acomptes des trimestres précédents et les retenues de l'année : trimestre par trimestre, cela revient exactement à la forme écrite ici. La déduction de 5 % pour gastos de difícil justificación est plafonnée à 2 000 € par an, ce que la règle ne sait pas borner : au-delà de 40 000 € de résultat annuel, corrigez-la. La minoración de 100 à 25 € pour un résultat de l'année précédente inférieur à 12 000 € n'est pas reprise.",
          modifiers: [
            {
              when: { start_reduction: ['yes'] },
              label:
                "Réduction de début d'activité : 20 % du résultat net positif, le premier exercice où il est positif et le suivant",
              effect: 'coefficient',
              value: 0.8,
              durationMonths: 24,
              condition:
                "Vous n'exerciez aucune activité l'année précédant le début, moins de 50 % de vos recettes viennent d'une personne dont vous avez été salarié l'année précédente, et la base de la réduction est plafonnée à 100 000 € par an.",
              source: START_REDUCTION_SOURCE,
            },
          ],
        },
        {
          name: 'IVA (modelo 303)',
          kind: 'vat',
          validFrom: '2026-01-01',
          source: {
            url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1992-28925',
            verifiedOn: '2026-09-04',
            reviewOn: '2027-01-01',
            status: 'confirmed',
          },
          baseMeasure: 'vat_balance',
          basePeriodRef: 'current',
          amountForm: 'rate',
          rate: 100,
          period: 'quarter',
          due: {
            type: 'fixed_dates',
            dates: [
              { month: 4, day: 20 },
              { month: 7, day: 20 },
              { month: 10, day: 20 },
              { month: 1, day: 30, yearOffset: 1 },
            ],
          },
          passThrough: true,
          note: "Déclaration trimestrielle dans les vingt premiers jours du mois suivant le trimestre, trente premiers jours de janvier pour le dernier. Taux général 21 %. L'Espagne n'a pas de franchise de TVA : la directive 2020/285 n'y est pas transposée. Un service rendu à une entreprise établie dans un autre État membre n'est pas soumis à l'IVA espagnole et entre au modelo 349.",
        },
      ],
      thresholds: [
        SIMPLIFIED_CAP,
        {
          label: 'Dispense de paiement fractionné',
          measure: 'withholding_share',
          periodRef: 'year-1',
          comparison: 'gte',
          value: 70,
          consequence:
            "Quand au moins 70 % des recettes de l'année précédente ont supporté une retenue, le modelo 130 n'est pas dû.",
          source: {
            url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820',
            verifiedOn: '2026-09-04',
            reviewOn: '2027-01-01',
            status: 'confirmed',
          },
        },
      ],
      inputs: [RETA_INPUT],
    },
    {
      id: 'es-bizkaia-start',
      name: 'Autónomo à Bizkaia, première ou deuxième année',
      description:
        'Territoire foral : le paiement fractionné des deux premiers exercices est de 20 % de la différence entre recettes et dépenses engagées dans le trimestre, moins les retenues du trimestre. Déclarations du 1er au 25 du mois suivant.',
      when: { tax_administration: ['bizkaia'], years_active: ['first_two'] },
      source: BIZKAIA_SOURCE,
      activity: ACTIVITY_DEFAULTS,
      levies: [
        RETA_LEVY,
        {
          name: 'Paiement fractionné IRPF (modelo 130 foral)',
          kind: 'income_tax',
          validFrom: '2026-01-01',
          source: BIZKAIA_IRPF_SOURCE,
          baseMeasure: 'profit',
          basePeriodRef: 'current',
          amountForm: 'rate',
          rate: 20,
          baseCredits: [{ source: 'withholdings', share: 100, periodRef: 'current' }],
          period: 'quarter',
          due: FORAL_DUE,
          note: "À partir de la troisième année, la règle change : elle devient un forfait de 5 % du rendimiento neto de l'avant-dernière année, moins 25 % des retenues de cette même année. Fermez cette règle ce jour-là et écrivez la suivante, l'historique du calcul restant lisible.",
          modifiers: [
            {
              when: { start_reduction: ['yes'] },
              label:
                "Réduction de début d'activité : 10 % du résultat net positif, le premier exercice où il est positif et le suivant",
              effect: 'coefficient',
              value: 0.9,
              durationMonths: 24,
              condition:
                "Vous n'exerciez pas déjà cette activité, directement ou indirectement, moins de 50 % de vos recettes viennent d'une personne dont vous avez été salarié l'année précédente, et le premier exercice à résultat positif tombe dans les cinq premiers exercices. La réduction est de 15 % pour une femme.",
              source: BIZKAIA_SOURCE,
            },
          ],
        },
        BIZKAIA_VAT_LEVY,
      ],
      thresholds: [BIZKAIA_SIMPLIFIED_CAP, BIZKAIA_EXEMPTION_THRESHOLD],
      inputs: [RETA_INPUT],
    },
    {
      id: 'es-bizkaia-established',
      name: 'Autónomo à Bizkaia, à partir de la troisième année',
      description:
        "Territoire foral : le paiement fractionné devient un forfait trimestriel, 5 % du rendimiento neto de l'avant-dernière année moins 25 % des retenues de cette même année, indépendant de l'activité du trimestre.",
      when: { tax_administration: ['bizkaia'], years_active: ['later'] },
      source: BIZKAIA_SOURCE,
      activity: ACTIVITY_DEFAULTS,
      levies: [
        RETA_LEVY,
        {
          name: 'Paiement fractionné IRPF (modelo 130 foral)',
          kind: 'income_tax',
          validFrom: '2026-01-01',
          source: BIZKAIA_IRPF_SOURCE,
          baseMeasure: 'profit',
          basePeriodRef: 'year-2',
          baseAbatement: {
            brackets: [
              { upTo: 35000, rate: 20 },
              { upTo: 85000, rate: 15 },
              { upTo: null, rate: 10 },
            ],
            on: { measure: 'profit', periodRef: 'year-2' },
          },
          amountForm: 'rate',
          rate: 5,
          baseCredits: [{ source: 'withholdings', share: 25, periodRef: 'year-2' }],
          period: 'quarter',
          due: FORAL_DUE,
          note: "Le rendimiento neto de la simplificada forale retire de la différence recettes moins dépenses un abattement de 20 %, 15 % ou 10 % selon que cette différence dépassait 35 000 € puis 85 000 € l'année précédente. La règle lit ce palier sur l'année du rendimiento, faute de pouvoir remonter une année de plus. Si le rendimiento de l'avant-dernière année n'était pas positif, le texte prévoit 0,5 % du volume des recettes : corrigez la règle dans ce cas.",
        },
        BIZKAIA_VAT_LEVY,
      ],
      thresholds: [BIZKAIA_SIMPLIFIED_CAP, BIZKAIA_EXEMPTION_THRESHOLD],
      inputs: [RETA_INPUT],
    },
  ],
}
