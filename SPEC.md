# Spec abacus : application de gestion de finances personnelles

> Slug : `abacus` (dépôt `pikmine-lab/abacus`, base/rôle `abacus`, `abacus.payangar.dev`).
> Statut : cadrage validé le 2026-08-19. Ce document est la référence du modèle.

## 1. Vision

Un « Excel amélioré » : une application web self-hosted (VPS pikmine) qui donne une vision
claire du présent (qu'est-ce que je dépense réellement, où optimiser, que dois-je laisser sur
chaque compte) et du futur (projection), plus le suivi des placements et de l'activité
freelance. **Multi-utilisateur** : chaque personne a son compte et ne voit que ses données ;
Pierre est simplement le premier utilisateur.

### Principes fondateurs

1. **Déclaratif complet.** Aucune connexion bancaire. Toutes les données personnelles sont
   saisies par l'utilisateur (via l'UI ou via Claude/MCP). Seule exception : les cours de
   bourse et de crypto, données publiques récupérées automatiquement.
2. **Le cas d'usage n'est jamais dans le code.** Le code définit des concepts (compte,
   mouvement, acteur, abonnement…) ; les banques, catégories, activités, taux sont des
   données saisies. Ajouter ou fermer un compte est du CRUD, pas du code.
3. **API-first.** Le cœur est une couche service sur Postgres. Le front web et le serveur MCP
   sont deux clients de cette couche, sans logique propre. Même geste = même résultat.
4. **Le MCP est une interface pour une IA.** Outils nommés par intention, descriptions qui
   disent quand utiliser et quand ne pas utiliser, lectures qui renvoient du contexte prêt à
   raisonner, erreurs qui guident. Testé en conditions réelles : chaque erreur de l'IA est
   traitée comme un défaut d'interface.
5. **Fiabilité par pointage.** Un système déclaratif dérive s'il n'est pas rapproché de la
   réalité : le pointage de solde est le garde-fou de première classe du modèle.
6. **Multi-utilisateur simple.** Toutes les entités du domaine appartiennent à un
   utilisateur (comptes, acteurs, activités, catégories… rien n'est partagé entre
   utilisateurs). Pas de multi-tenancy sophistiquée : une colonne de propriété et une
   authentification sérieuse suffisent. L'authentification n'est pas réinventée : on
   s'appuie sur une solution existante (voir §5).

## 2. Modèle de domaine

### Compte
Un compte détenu par l'utilisateur. Champs : nom, établissement (texte libre), type de
comportement, devise (EUR uniquement en V1, multi-devise en V2, voir §6), dates
d'ouverture/clôture.
Le **type de comportement** est la seule typologie en dur, car elle décrit des capacités :
- `flux` (compte courant) : porte des mouvements ;
- `epargne` (livret) : porte des mouvements (virements, intérêts) ; faible volume ;
- `investissement` (PEA, CTO, crypto) : porte des opérations d'investissement et des positions.

Un compte clos reste en base (l'historique survit au montage bancaire du moment) et se
réouvre : une clôture par erreur ne doit pas obliger à recréer le compte.
Nom, établissement et type de comportement se corrigent. Le type cesse de bouger dès que
le compte porte des opérations d'investissement, que seul ce type peut porter.

### Acteur
La contrepartie externe d'un mouvement : commerçant, client, organisme (URSSAF), employeur.
Champs : nom canonique, alias[], activité optionnelle, notes. Tous se corrigent ; le nom
corrigé remplace l'ancien, qui cesse de résoudre, parce qu'une faute de frappe doit
disparaître. Un nom réellement porté se garde en alias, geste distinct et explicite.
- La normalisation se fait à la déclaration : résolution contre noms canoniques + alias
  (« McDo », « Macdo » → *McDonald's*). L'UI propose l'autocomplétion ; le MCP résout et
  signale les créations d'acteur pour validation.
- Fusion d'acteurs possible a posteriori (les alias absorbent les doublons).
- L'acteur rend l'analyse précise : « 20 € chez McDo » plutôt qu'un flou « resto ».

### Activité
Sphère économique créée par l'utilisateur (ex. *Freelance*). Optionnelle.
- Attachée à un acteur (un client, l'URSSAF → *Freelance*), elle est héritée par les
  mouvements de cet acteur, surchargeable mouvement par mouvement.
- Un mouvement sans activité relève du perso par défaut.
- C'est ce qui porte le suivi freelance sans rien coder en dur : CA annuel = revenus de
  l'activité, charges = dépenses de l'activité (URSSAF…), net = différence.

### Mouvement
Le cœur du modèle. Champs : date, montant, **source**, **destination**, catégorie (si flux
externe), activité (héritée/surchargée), note, référence d'origine (abonnement, ajustement…).
- Source et destination sont chacune : un compte détenu **ou** un acteur externe.
- La **nature est dérivée**, jamais stockée : compte → compte = virement interne (neutre,
  jamais compté en dépense) ; compte → acteur = dépense ; acteur → compte = revenu.
- Granularité : transaction par transaction (décision du 2026-08-19), la saisie quotidienne
  étant assumée par une routine + le MCP (déclaration en langage naturel par lot).

### Catégorie
Définie par l'utilisateur. À plat, avec groupe optionnel (pas d'arborescence profonde).
S'applique uniquement aux mouvements avec l'extérieur, revenus compris : la nature d'un
gain (salaire, intérêts, cadeau, remboursement, plus-value, revenu annexe…) est une
catégorie, sa provenance est l'acteur, sa sphère est l'activité. Aucun type de gain n'est
codé en dur. Un intérêt de livret ou de compte se déclare simplement au moment où il est
reçu : revenu de l'acteur banque vers le compte concerné. L'URSSAF est une dépense
ordinaire : acteur *URSSAF* (activité Freelance) + catégorie du type « Cotisations
sociales », le tout étant des données.

### Avance et remboursement
Cas : payer pour quelqu'un et attendre un remboursement, éventuellement partiel.
- La dépense peut être marquée « avance », avec l'acteur qui doit rembourser.
- Un revenu de remboursement se **lie** à la dépense avancée (même mécanisme de référence
  d'origine que pour les échéances).
- La **créance** est dérivée : montant avancé moins remboursements liés, par acteur. Une
  créance peut être soldée explicitement (abandon du reste : « il ne remboursera que
  50 % »), pour ne pas traîner éternellement.
- Les analyses de dépenses distinguent **deux lectures, toutes deux visibles** : le
  **brut** (ce qui est réellement sorti des comptes, la dépense « est ce qu'elle est ») et
  le **net** (brut moins remboursements liés **effectivement reçus**). Une créance en
  attente ne réduit jamais le net : tant que l'argent n'est pas revenu, la dépense est
  entière, et une avance jamais remboursée reste simplement une dépense pleine.

### Engagement récurrent : abonnement et financement
Engagement déclaré, lié à un acteur et à un compte de prélèvement, en deux formes :
- **Abonnement** (durée ouverte) : montant, périodicité, catégorie, prochaine échéance,
  fin d'engagement éventuelle, **jugement** (essentiel / réductible / à résilier + note).
- **Financement** (durée finie) : paiement en X fois. Montant total, nombre d'échéances,
  montant par échéance, achat financé (libellé/acteur). Le **restant dû** est dérivé des
  échéances déjà passées. Pas de modélisation d'intérêts en V1 : les frais éventuels sont
  simplement dans les montants d'échéance. L'échéancier écrit se **révise** après coup, et
  c'est lui qui fait foi : le montant total suit la somme de ses lignes, ce qui rend
  exprimables un report, une renégociation ou un solde anticipé.

Les deux formes partagent le même moteur d'échéances et alimentent la projection ; un
financement s'éteint de lui-même à la dernière échéance.
- **Historique en événements datés** : création, changement de prix, résiliation. Jamais
  d'écrasement ; l'app peut dire « +40 % en deux ans ».
- **Générateur d'échéances** : l'app produit les mouvements attendus de la période,
  l'utilisateur confirme d'un geste (ou ajuste). Vaut aussi pour les récurrences de revenus
  (salaire) : même mécanisme, sens inverse.
- Le rapprochement échéance attendue ↔ mouvement constaté détecte les hausses silencieuses
  et les abonnements oubliés.

### Pointage de solde
Déclaration « solde réel du compte X à la date D : N € ». L'app compare au solde calculé
depuis les mouvements ; un écart est signalé et peut être soldé par **un** mouvement
d'ajustement explicite (catégorisable), un seul par pointage. Le tableau de bord affiche
l'âge du dernier pointage par compte.

Un pointage se corrige (montant lu, date) et se supprime. Le corriger, c'est le refaire :
le solde calculé est recalculé sur l'historique tel qu'il est alors, pour la date donnée,
son propre ajustement exclu du calcul. L'ajustement suit l'écart obtenu : réaligné, ou
supprimé quand il n'y a plus rien à solder. Supprimer le pointage supprime l'ajustement,
qui n'existait que pour lui.

### Investissements (comptes de type `investissement`)
- **Opération** déclarée : achat, vente, dividende, frais, dépôt/retrait d'espèces.
- **Position** calculée : quantité, PRU, valeur au dernier cours.
- **Actif** : identifiant (ISIN/ticker/id CoinGecko), source de cours.
- **Cours automatiques** : actions/ETF via Yahoo Finance ou Boursorama (non officiel),
  crypto via CoinGecko (plan gratuit). Rafraîchissement quotidien, faible volume.
- **Performance à méthode explicite** : chaque chiffre affiché dit comment il est calculé
  (avec/sans dividendes, frais inclus ou non), pour ne plus jamais avoir d'écart inexpliqué
  entre deux outils.

## 3. Vues principales

1. **Tableau de bord** : patrimoine total et par compte, écarts de pointage, échéances à
   confirmer, coût récurrent mensuel engagé, créances en cours (qui me doit quoi).
2. **Dépenses** : par période, catégorie, acteur, activité. Les virements internes n'y
   apparaissent jamais.
3. **Abonnements et financements** : abonnements avec jugements, coût mensuel/annuel
   équivalent, historique de prix, candidats à résiliation ; financements en cours avec
   restant dû et date de fin. Le « coût récurrent mensuel engagé » inclut les financements
   jusqu'à leur terme.
4. **Freelance** (vue par activité) : CA par année civile, charges, net encaissé.
5. **Placements** : positions, valorisation, performance à méthode explicite.
6. **Projection** : soldes projetés à partir des échéances (abonnements, salaire) et des
   moyennes constatées. V1 simple (fin de mois / fin d'année), scénarios plus tard.

## 4. Serveur MCP

Couche mince sur la couche service. Outils exprimés en intentions (liste indicative v1,
les descriptions détaillées sont un livrable d'implémentation à part entière) :

- `declare_movements` : déclarer un lot de mouvements en une fois (dépenses, revenus,
  virements) ; résout les acteurs, signale les créations et les ambiguïtés.
- `record_balance_check` : pointer un solde ; renvoie l'écart et propose l'ajustement.
- `manage_subscription` : créer / changer le prix / résilier (événements datés).
- `declare_financing` : déclarer un paiement en X fois ; lit aussi les restants dus.
- `confirm_due_movements` : confirmer les échéances attendues de la période.
- `record_investment_operations` : déclarer achats, ventes, dividendes, frais.
- `get_overview` : état prêt à raisonner (soldes, âge des pointages, écarts, échéances).
- `analyze_spending` : dépenses par catégorie/acteur/activité sur une période.
- `get_portfolio` : positions et performance.
- `manage_accounts` / `manage_actors` / `manage_categories` : administration (dont fusion
  d'acteurs).

## 5. Stack et déploiement (conventions pikmine-lab)

- **Next.js + Postgres**. Instance Postgres partagée du socle, une base et un rôle dédiés
  au slug de l'app (création SQL, convention du socle). Accès uniquement via `DATABASE_URL`.
- Couche données : SQL à la main, datasources CRUD sans métier (convention radar).
- Monorepo pnpm (`apps/*`, `packages/*`) : le front Next.js et le serveur MCP Node sont deux
  apps consommant le même package cœur (domaine + services).
- **Authentification : Better Auth** (TypeScript, sessions sur Postgres, framework-agnostic,
  actif en 2026). Email/mot de passe suffit au départ ; le MCP s'authentifie par token
  d'API par utilisateur. Alternative écartée sauf blocage à l'implémentation : Auth.js.
- Déploiement : dépôt public dans l'org GitHub `pikmine-lab`, socle privé en submodule
  `vendors/infra`, **un Dockerfile**, image construite par GitHub Actions → GHCR,
  déploiement par appel explicite à l'API Dokploy après les tests (jamais l'auto-deploy
  natif). Projet Dokploy dédié. Aucun secret dans le dépôt ni l'image ; secrets partagés
  dans le vault Infisical du socle.
- Contrat socle : `DATABASE_URL`, `PUBLIC_URL` (`https://<slug>.payangar.dev`) ; `OLLAMA_URL`
  disponible mais sans usage prévu ici.
- **Sauvegardes : risque assumé au démarrage** (décision Pierre, 2026-08-19). Le socle n'a
  aucune sauvegarde Postgres, et contrairement à radar ces données ne sont pas
  recollectables. Acceptable tant que l'historique saisi reste re-déclarable de tête ;
  **déclencheur** : mettre en place la sauvegarde (S3 planifié Dokploy ou équivalent) dès
  que re-saisir l'historique ferait mal, au plus tard quand l'app devient l'outil de
  référence.

## 6. Périmètre par étapes

- **V1** : comptes, acteurs, activités, catégories, mouvements, pointages, abonnements et
  financements + échéances, tableau de bord, vues dépenses/abonnements/freelance,
  projection simple, MCP.
- **V2** : investissements (opérations, positions, cours automatiques, vue placements) ;
  multi-devise (voir ci-dessous).
- **V3** : projection avancée (scénarios), et le reste selon l'usage réel.

### Multi-devise (décidé le 2026-08-19, implémentation V2)
V1 est EUR uniquement, mais le schéma est prêt dès le départ : chaque montant porte sa
devise (`EUR` partout en V1), pour ne jamais avoir à migrer les données. En V2 : dépenses
en devise étrangère (USD…) avec **suivi du cours réel**, pas une constante ; la mécanique
de récupération des cours est la même que pour les actifs boursiers. Point à trancher en
V2 : conversion au cours du jour de la transaction (fige le coût en EUR) vs au cours
courant (réévalue), sachant que pour des dépenses c'est le cours du jour de la
transaction qui reflète la réalité.

## 7. Points ouverts

1. **Ordre V1/V2** : les placements peuvent passer en V1 si le besoin est plus chaud que
   prévu ; le modèle ne change pas.
2. **Routine de saisie** : fréquence de la déclaration des dépenses (quotidienne ou
   hebdomadaire) et du pointage (hebdomadaire ou mensuel) ; à régler côté Todoist quand
   l'app existera.
