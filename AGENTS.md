# abacus

Application web de gestion de finances personnelles de Pierre, multi-utilisateur, self-hosted.

**URL cible** : `abacus.payangar.dev`
**Hôte** : VPS `pikmine`, déploiement via Dokploy (mêmes conventions que radar)
**Rigueur** : durable. Ce projet est fait pour tenir, pas pour démontrer.

**`SPEC.md` est la référence du modèle de domaine.** Ne pas redécider ici ce qui y est tranché.

**`DESIGN.md` est la référence de l'interface.** À lire avant toute modification d'UI : palette,
règles de graphes et usages de composants y sont tranchés, pas ici.

## Les principes qui gouvernent ce dépôt

- **Tout déclaratif.** Aucune connexion bancaire, jamais. Les données personnelles sont
  saisies (UI ou MCP). Seule exception : les cours de bourse/crypto, données publiques.
- **Le cas d'usage de Pierre n'entre jamais dans le code.** Banques, catégories, activités,
  taux : ce sont des données. Si une PR contient « Fortuneo » ou « URSSAF » en dur, elle est
  fausse par principe.
- **API-first.** Le cœur est la couche service de `packages/core`. Le front Next.js et le
  serveur MCP sont deux clients sans logique propre.
- **Le MCP est une interface pour une IA, portée par le code.** L'IA qui le consomme n'a
  jamais accès à ce dépôt : les définitions d'outils (noms, descriptions, erreurs) sont son
  seul monde. Une description d'outil se travaille comme une UI ; une erreur de l'IA en
  usage réel se traite comme un défaut d'interface, pas comme un défaut d'IA.
- **Deux interfaces, un même pouvoir.** Le web et le MCP visent deux acteurs différents,
  une personne et une IA, mais ouvrent les mêmes cas d'usage : ce qui se déclare, se
  corrige ou se supprime d'un côté doit pouvoir l'être de l'autre. Une fonctionnalité
  livrée dans une seule des deux est incomplète, pas « en cours ». Cela ne veut pas dire
  les mêmes formulaires : chacune parle la langue de son acteur (des noms et une
  description qui enseigne côté MCP, des listes et des valeurs préremplies côté web).
- **Le français s'arrête à ce qui s'affiche.** La frontière est le lecteur, pas le
  fichier : ce qu'une personne lit devant l'application est en français, tout ce que seul
  le code lit est en anglais. Segments d'URL, clés et valeurs de paramètres de requête,
  noms de champs de formulaire, identifiants, noms de fichiers, slugs de branches,
  commentaires et messages de commit : anglais. Les documents du dépôt (`SPEC.md`,
  `DESIGN.md`, ce fichier) et les issues restent en français.
- **Intégrité par construction.** La nature d'un mouvement (dépense, revenu, virement
  interne) est une colonne générée depuis ses extrémités ; les règles du modèle sont des
  contraintes SQL, pas des validations applicatives dupliquées.

## Stack

- **Next.js + Postgres** (instance partagée du socle, base et rôle `abacus`). L'accès
  arrive uniquement par `DATABASE_URL`, jamais de nom d'hôte en dur.
- **Better Auth** pour l'authentification. Ses tables sont préfixées `auth_*` pour ne pas
  percuter la table métier `account`. Tokens MCP par utilisateur via son plugin api-key.
- Couche données : **SQL à la main**, datasources CRUD sans métier prenant un `Executor`
  (pool ou transaction), la transaction appartenant à la couche service.
- Migrations : `migrations/*.sql`, forward-only, runner `nr migrate` (advisory lock,
  une transaction). `0001` = schéma Better Auth généré, `0002` = domaine.
- Monorepo pnpm : `packages/core` (domaine + services + datasources), `apps/web` (Next.js),
  `apps/mcp` (serveur MCP).

## Développement local

Base Postgres jetable en Docker, **ISO socle** : même image (`pgvector/pgvector:pg16`),
même découpage rôle/base `abacus`, mêmes extensions (`vector`, `pg_trgm`, `unaccent`,
créées par `scripts/dev-db-init.sql`). Jamais de travail sur la base de prod en local.

```sh
nr db:up         # démarre la base (port local 5544)
nr migrate:dev   # applique les migrations dessus
nr db:reset      # base vierge (détruit le volume)
```

L'app web se lance avec `pnpm --filter @abacus/web dev` et lit `apps/web/.env.local`
(non commité) : `DATABASE_URL` vers la base Docker, `BETTER_AUTH_SECRET` quelconque,
`PUBLIC_URL=http://localhost:3000`, et `MCP_URL` (l'endpoint que l'écran « Brancher une
IA » livre ; sans elle, l'écran le signale au lieu d'afficher une commande fausse).

**Piège d'outillage** : `nr lint | tail` masque le code de sortie (pas de pipefail) ;
toujours vérifier le lint sans pipe avant de committer, la CI l'attrapera sinon.

Les identifiants `abacus:abacus@127.0.0.1:5544` sont locaux et jetables, ce ne sont pas
des secrets. Tout le reste passe par `DATABASE_URL`.

## Suivi par issues

Toute intention sur ce dépôt se trace en issue GitHub, même quand personne ne l'attaque
tout de suite. Le code dit ce qui est fait, l'issue est le seul endroit qui garde le
pourquoi, ce qui a été écarté et ce qui a causé quoi. Quand Pierre décrit une
fonctionnalité ou un bug qu'il ne traite pas dans la session, proposer de le tracer.

- Avant de travailler un sujet, chercher ses précédents, ouverts comme fermés
  (`gh issue list --state all --search …`) : la décision a peut-être déjà été prise.
- L'issue porte le quoi et le pourquoi, Todoist porte le quand. Une tâche qui double une
  issue la référence, elle ne recopie pas son contenu.
- Branche `<type>/<numéro>-<slug>`, la PR close l'issue.

La skill `issue-tracking` détaille la rédaction, les types et les liens.

## Flux de travail (depuis le 2026-08-19)

**`main` = production, déploiement continu.** Chaque commit sur `main` déclenche
tests → build des deux images → déploiement Dokploy. En conséquence :

- **Les features passent par une pull request.** Branche courte, PR vers `main`, la CI
  (lint, typecheck, tests, build web et images) doit être verte avant merge. Le merge
  déploie, il n'y a pas d'étape manuelle.
- Un commit direct sur `main` reste techniquement possible mais réservé aux corrections
  triviales ; tout ce qui porte du comportement passe en PR.
- Rollback : relancer le provisionneur avec un tag antérieur
  (`cd provision && IMAGE_TAG=sha-… node src/provision.ts`, tags visibles sur GHCR).

## Déploiement

Continu, sur le modèle de `pikmine-lab/space-engineers` : le dépôt embarque son
provisionneur (`provision/`, zéro dépendance, idempotent, API Dokploy uniquement) et la CI
le rejoue à chaque commit sur `main` avec le tag `sha-…` fraîchement construit. Le
provisionneur ne supprime jamais rien ; `node provision/src/provision.ts --dry-run` montre
l'écart sans agir (variables dans `provision/.env` local, jamais commité).

- Images : `ghcr.io/pikmine-lab/abacus-web` (Next standalone) et `abacus-mcp` (migre la
  base à son démarrage, verrou advisory). Tags `sha-<court>` immuables + `latest`.
- Stack : `deploy/docker-compose.yml`, projet Dokploy `abacus`, réseau `dokploy-network`,
  domaines `abacus.payangar.dev` (web) et `abacus-mcp.payangar.dev` (MCP), TLS Let's
  Encrypt via Traefik. Base et rôle `abacus` sur le Postgres partagé du socle (création
  one-shot en SSH, hors provisionneur).
- Secrets : environnement GitHub `production` restreint à `main` (`DOKPLOY_URL`,
  `DOKPLOY_AUTH_TOKEN`, `APP_DATABASE_URL`, `BETTER_AUTH_SECRET`) ; copies locales dans
  `~/.config/abacus/`. Dépôt public : aucun secret, aucune topologie serveur ici.
- Variables runtime des conteneurs : `DATABASE_URL`, `PUBLIC_URL`, `BETTER_AUTH_SECRET`
  (obligatoire en production, sinon crash à la première requête), `PORT` (MCP), `MCP_URL`
  (web : l'endpoint MCP donné à l'utilisateur, écrit par le provisionneur depuis `SPEC`).
- Actions GitHub épinglées par commit, jamais par tag.
- **Piège** : les checks requis de la protection de `main` portent les noms complets des
  jobs matrix (`build (web, apps/web/Dockerfile)`). Renommer un Dockerfile ou la matrice
  casse silencieusement le merge des PR (checks « attendus » à jamais) : mettre à jour la
  protection en même temps.

## Se connecter au MCP de production

Le serveur MCP vit sur `https://abacus-mcp.payangar.dev/mcp` (transport HTTP, auth
`Authorization: Bearer <clé d'API>`). Les clés sont par utilisateur, gérées par le plugin
api-key de Better Auth. L'écran **Brancher une IA** (menu du compte) crée la clé et rend
la commande complète, prête à coller, pour Claude Code comme pour un client à
`mcpServers` : c'est la source à jour, ne pas recopier de commande ici.

Une clé ne branche que les clients qui acceptent un en-tête HTTP (Claude Code, Cursor,
VS Code, Codex). Les connecteurs personnalisés de l'application Claude ne prennent qu'une
URL et un OAuth, que le serveur MCP ne sait pas encore servir.

## État (2026-08-20)

**En production** sur `abacus.payangar.dev` : auth multi-utilisateur, serveur MCP
(17 outils), déploiement continu opérationnel (validé de bout en bout par PR).

**Interface refondue le 2026-08-20** (voir `DESIGN.md`, qui a été réécrit) : navigation
latérale pliable groupée par question posée, palette bleu-nuit / cuivre mesurée, saisie
sortie des pages de lecture vers un panneau latéral, engagements coupés en dépenses et
revenus récurrents, période pilotable depuis l'URL sur toutes les vues, filtres complets
sur les mouvements, correction et suppression d'un mouvement, écran d'accueil guidé,
identité (marque abaque + favicon). Les cas d'usage ouverts dans l'UI existent aussi
côté MCP : `fix_movement` (corriger ou supprimer une déclaration erronée) et, sur
`confirm_due_movements`, la qualification d'un écart (ponctuel ou nouveau montant de
référence, historisé).

**Raccordement d'une IA** (2026-08-21) : la création de clé a quitté Réglages pour son
propre écran, **Brancher une IA** (menu du compte) : deux pas numérotés, créer la clé puis
coller la commande complète, en deux formes (CLI Claude Code, bloc `mcpServers` pour les
clients à fichier). Rien n'est mémorisé du client choisi : la commande entière n'existe
que le temps où la clé est visible. Le premier jet, trop bavard, a produit la règle
`DESIGN.md` § *Ce qu'on écrit à l'écran*, qui vaut pour tous les écrans.

**Échéanciers de financement** (2026-08-20) : un financement porte un échéancier
écrit (`financing_installment`, migration `0003`), chaque échéance ayant sa date et
son montant, ajustables à la création depuis l'UI comme depuis le MCP. Le restant dû
est la somme des échéances non réglées.

**Révision d'un échéancier** (2026-08-21, issue #13) : ce plan se révise après coup, en
bloc (UI : « Réviser l'échéancier » dans le menu de la ligne ; MCP :
`manage_financing_schedule`). L'échéancier fait foi : `total_amount`, le nombre
d'échéances, le montant nominal et la prochaine échéance sont recalculés depuis ses
lignes. Une échéance réglée et son mouvement restent synchronisés dans les deux sens :
montant et date, corriger l'un corrige l'autre, retirer la ligne supprime le mouvement.

**Correction d'un engagement** (2026-08-21) : ce qu'un engagement dit de lui-même se
corrige (nom, acteur, compte, catégorie, périodicité) : UI « Modifier » dans le menu de
la ligne, MCP `update_commitment`. La correction vaut pour les échéances à venir ; les
mouvements déjà déclarés ne sont jamais réécrits, ils constatent ce qui s'est passé sur
le compte où ça s'est passé. Restent hors correction : le montant, qui est une histoire
datée (`change_price`), et la direction, qui ferait d'un engagement un autre.

**Chaque entité déclarée se corrige** (2026-08-21, issue #21) : un compte (nom,
établissement, type, et réouverture après une clôture), un acteur (nom, activité, note),
une catégorie (nom, groupe), une activité (nom) et un pointage de solde (montant lu, date,
suppression). Côté MCP, une action `update` sur chaque outil `manage_*` et un nouvel outil
`manage_balance_checks` (list, correct, delete).

Deux points tranchés au passage :

- le **type d'un compte** se corrige, sauf quand le compte porte des opérations
  d'investissement, que seul ce type peut porter ;
- **corriger un pointage, c'est le refaire** : l'écart est recalculé sur l'historique du
  jour, pour la date donnée, son propre ajustement exclu du calcul ; l'ajustement qui le
  soldait suit (réaligné, ou supprimé quand il n'y a plus rien à solder), et supprimer le
  pointage l'emporte avec lui. La migration `0004` fait de « un ajustement par pointage »
  une contrainte SQL plutôt qu'une convention.

Réglages est passé en listes de lignes à menu `⋯` (les acteurs avec une recherche), et la
parité des deux interfaces est rétablie partout où elle manquait :

- l'UI d'engagement propose la périodicité complète (posée comme une seule question :
  « toutes les 2 semaines »), la fin d'engagement et l'activité ;
- `list_movements` (MCP) renvoie le compte, la contrepartie et la catégorie de chaque
  mouvement, que l'UI affichait déjà ;
- l'UI sait ajouter un alias et fusionner deux acteurs, et solder l'écart d'un pointage.
  Ces trois-là n'existaient que côté MCP, alors que c'est la saisie web qui fabrique les
  doublons d'acteurs (un nom qui ne résout pas crée l'acteur) et que le panneau de pointage
  promettait un ajustement qu'elle ne savait pas créer.

**Avance et remboursement** (2026-08-21, issue #28) : une avance porte la **part
attendue** (`expected_refund_amount`, migration `0005`), écrite et non plus déduite du
montant : payer 120 € et n'en attendre que 90 s'exprime. Le remboursement est toujours le
revenu qui rentre, jamais un drapeau : les avances ouvertes s'affichent en tête des
mouvements et « Remboursé » écrit ce revenu sur le compte qui a payé (MCP :
`declare_movements` avec `refundsMovementId`, ou `alreadyRefunded` quand l'argent revient
le jour même). Solder reste l'autre geste, celui du renoncement. La part et le débiteur se
corrigent (`fix_movement`) ; le lien d'un remboursement reçu vers son avance, non.

**Le compte d'un engagement est daté** (2026-08-21, issue #35) : un prélèvement qui
déménage se déclare le jour où on l'apprend, date d'effet future comprise (UI « Changer de
compte » dans le menu de la ligne, MCP `change_commitment_account`), et chaque échéance
tombe sur le compte en vigueur à sa date. Une échéance confirmée en retard part donc de
l'ancien compte, là où l'argent est réellement sorti, au lieu d'être écrite en silence sur
le nouveau. Le compte a quitté la correction sans date (`update_commitment`), comme le
montant avant lui. Côté modèle : `commitment.account_id` est le compte de départ, chaque
déménagement est un événement `account_changed` (migration `0006`), et les lectures
exposent le compte du jour plus le déménagement annoncé.

**Anglais hors de l'écran** (2026-08-21, issue #24) : les segments d'URL, les clés et les
valeurs de paramètres de requête et les noms de champs de formulaire sont passés en
anglais, et le principe « le français s'arrête à ce qui s'affiche » est écrit plus haut.
Les anciennes adresses ne répondent plus : pas de redirection, rupture assumée pour une
production de deux jours à un seul utilisateur.

**Le graphe de soldes compare six comptes** (2026-08-21, issue #32) : il s'ouvre sur les
comptes les mieux garnis et non sur les premiers par ordre alphabétique, n'oppose plus de
plafond de trois séries, et son label de fin de ligne tient dans le cadre. La palette de
séries passe de trois à six teintes (`--chart-4..6`), maximum mesuré à côté des trois
premières : la pire paire tombe dans la bande CVD 6-8, légale uniquement avec un encodage
secondaire, ce qui fait des labels directs la condition de la palette plutôt qu'un confort.
D'où le lien entre les trois défauts. `DESIGN.md` § Couleur porte les chiffres.

**Sauvegardes** : le socle n'a pas de sauvegarde Postgres et ces données ne sont pas
recollectables. Risque assumé au démarrage (décision du 2026-08-19).
