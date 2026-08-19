# abacus

Application web de gestion de finances personnelles de Pierre, multi-utilisateur, self-hosted.

**URL cible** : `abacus.payangar.dev`
**Hôte** : VPS `pikmine`, déploiement via Dokploy (mêmes conventions que radar)
**Rigueur** : durable. Ce projet est fait pour tenir, pas pour démontrer.

**`SPEC.md` est la référence du modèle de domaine.** Ne pas redécider ici ce qui y est tranché.

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

Les identifiants `abacus:abacus@127.0.0.1:5544` sont locaux et jetables, ce ne sont pas
des secrets. Tout le reste passe par `DATABASE_URL`.

## Déploiement

Mêmes décisions que radar, à ne pas rejouer : un Dockerfile, image construite par GitHub
Actions → GHCR (`ghcr.io/pikmine-lab/abacus`), déploiement par appel explicite à l'API
Dokploy après les tests (jamais l'auto-deploy natif), projet Dokploy dédié, secrets via le
vault Infisical du socle, socle privé en submodule `vendors/infra` le moment venu.

Dépôt public : aucun secret, aucune topologie serveur ici.

CI (`.github/workflows/ci.yml`) : chaque commit sur `main` (et chaque PR) exécute typecheck +
tests contre un Postgres ISO socle, puis construit l'image `ghcr.io/pikmine-lab/abacus-mcp`
(poussée uniquement depuis `main`). L'image migre la base à son démarrage. Variables requises
au runtime : `DATABASE_URL`, `PUBLIC_URL`, `BETTER_AUTH_SECRET` (obligatoire en production,
sinon crash à la première requête), `PORT` (défaut 3000).

**Sauvegardes** : le socle n'a pas de sauvegarde Postgres et ces données ne sont pas
recollectables. Risque assumé au démarrage (décision du 2026-08-19) ; à mettre en place dès
que re-saisir l'historique ferait mal.
