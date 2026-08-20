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
`PUBLIC_URL=http://localhost:3000`.

**Piège d'outillage** : `nr lint | tail` masque le code de sortie (pas de pipefail) ;
toujours vérifier le lint sans pipe avant de committer, la CI l'attrapera sinon.

Les identifiants `abacus:abacus@127.0.0.1:5544` sont locaux et jetables, ce ne sont pas
des secrets. Tout le reste passe par `DATABASE_URL`.

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
  (obligatoire en production, sinon crash à la première requête), `PORT` (MCP).
- Actions GitHub épinglées par commit, jamais par tag.
- **Piège** : les checks requis de la protection de `main` portent les noms complets des
  jobs matrix (`build (web, apps/web/Dockerfile)`). Renommer un Dockerfile ou la matrice
  casse silencieusement le merge des PR (checks « attendus » à jamais) : mettre à jour la
  protection en même temps.

## Se connecter au MCP de production

Le serveur MCP vit sur `https://abacus-mcp.payangar.dev/mcp` (transport HTTP, auth
`Authorization: Bearer <clé d'API>`). Les clés sont par utilisateur, gérées par le plugin
api-key de Better Auth, et se créent depuis l'écran **Réglages**. Côté Claude :
`claude mcp add --transport http abacus https://abacus-mcp.payangar.dev/mcp --header "Authorization: Bearer <clé>"`.

## État (2026-08-20)

**En production** sur `abacus.payangar.dev` : auth multi-utilisateur, serveur MCP
(16 outils), déploiement continu opérationnel (validé de bout en bout par PR).

**Interface refondue le 2026-08-20** (voir `DESIGN.md`, qui a été réécrit) : navigation
latérale pliable groupée par question posée, palette bleu-nuit / cuivre mesurée, saisie
sortie des pages de lecture vers un panneau latéral, engagements coupés en dépenses et
revenus récurrents, période pilotable depuis l'URL sur toutes les vues, filtres complets
sur les mouvements, correction et suppression d'un mouvement, écran d'accueil guidé,
identité (marque abaque + favicon).

**Reste à faire** : V2 placements (opérations, positions, cours automatiques : schéma déjà
en base), multi-devise (V2, schéma prêt), vue projection de la SPEC, vue freelance par
activité, sauvegardes Postgres (déclencheur documenté dans SPEC.md), éprouver l'interface
MCP en session réelle, densité UI à trancher sur données réelles (DESIGN.md).

**Sauvegardes** : le socle n'a pas de sauvegarde Postgres et ces données ne sont pas
recollectables. Risque assumé au démarrage (décision du 2026-08-19) ; à mettre en place dès
que re-saisir l'historique ferait mal.
