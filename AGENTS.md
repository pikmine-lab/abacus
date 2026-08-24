# abacus

Application web de gestion de finances personnelles, multi-utilisateur, self-hosted : ce
qui est dépensé aujourd'hui, ce à quoi on est engagé demain, les placements et l'activité
freelance. Pierre est le premier utilisateur, pas un cas particulier du code.

**URL cible** : `abacus.payangar.dev`
**Hôte** : VPS `pikmine`, déploiement via Dokploy (mêmes conventions que radar)
**Rigueur** : durable. Ce projet est fait pour tenir, pas pour démontrer.

**Le modèle de domaine se lit dans le code** : les migrations (`migrations/*.sql`) pour ce
que le schéma garantit, les services (`packages/core/src/services/`) pour ce que chaque
geste fait et refuse. Leurs commentaires portent le pourquoi, à côté de ce qu'il gouverne ;
ne pas redécider ailleurs ce qui y est écrit.

**`DESIGN.md` est la référence de l'interface.** À lire avant toute modification d'UI :
palette, règles de graphes et principes d'écran y sont tranchés, pas ici.
**`apps/web/AGENTS.md`** porte les règles de code du front, et se lit avant d'y toucher.

## Les principes qui gouvernent ce dépôt

- **Tout déclaratif.** Aucune connexion bancaire, jamais. Les données personnelles sont
  saisies (UI ou MCP). Seule exception : les cours de bourse/crypto, données publiques.
- **Le cas d'usage de Pierre n'entre jamais dans le code.** Banques, catégories, activités,
  taux : ce sont des données. Si une PR contient « Fortuneo » ou « URSSAF » en dur, elle est
  fausse par principe.
- **Fiabilité par pointage.** Une comptabilité entièrement déclarative dérive si rien ne la
  rapproche du réel : le pointage de solde est le garde-fou de première classe du modèle,
  pas une commodité. Ce qui l'affaiblit affaiblit tout le reste.
- **La propriété est une colonne, pas une architecture.** Chaque entité du domaine
  appartient à un utilisateur et n'est visible que de lui ; une colonne de propriété et une
  authentification sérieuse suffisent. Seule exception, qui découle du premier principe :
  une donnée publique n'appartient à personne, donc un instrument coté et ses cours sont
  partagés par tous, quand ce que chacun en détient reste à lui.
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
  commentaires et messages de commit : anglais. Les documents du dépôt (`DESIGN.md`, ce
  fichier, les `AGENTS.md` imbriqués) et les issues restent en français.
- **Intégrité par construction.** La nature d'un mouvement (dépense, revenu, virement
  interne) est une colonne générée depuis ses extrémités ; les règles du modèle sont des
  contraintes SQL, pas des validations applicatives dupliquées.

## Où s'écrit une décision

Chaque chose a un endroit et un seul. Se tromper d'endroit ne se voit pas le jour même :
ça se voit des semaines plus tard, quand deux fichiers disent la même chose et qu'un seul
a été mis à jour.

| Ce qui vient d'être décidé | Où ça s'écrit |
|---|---|
| Un invariant du modèle : ce qu'une donnée garantit, ce qu'un calcul ne doit jamais regarder | En commentaire de la migration qui pose la contrainte |
| Une règle de geste : ce qui se déclare, se corrige, se refuse, et pourquoi | En commentaire du service de `packages/core` qui la porte, là où les deux interfaces la lisent |
| Une règle d'apparence : couleur, densité, forme d'un graphe, ton des textes | `DESIGN.md` |
| Une règle de code front : piège React/Next, usage du système de composants, forme d'un écran | `apps/web/AGENTS.md` |
| Le récit : ce qui a été mesuré, ce qui a été écarté, ce qui a causé quoi | L'issue |

Trois conséquences, qui valent pour les cinq lignes :

- **Rien ici ne porte de date ni de numéro d'issue en guise d'histoire.** Ces fichiers
  décrivent l'état actuel, au présent. Une décision qui en corrige une autre la
  **remplace** au lieu de s'ajouter à côté : deux formulations d'un même fait valent zéro,
  et c'est la périmée qu'on croira. Git dit quand, l'issue dit pourquoi. Un renvoi vers une
  issue **ouverte** reste légitime : c'est un pointeur vers une décision en cours, pas du
  récit.
- **Rien ici ne tient d'état des lieux.** Un inventaire de ce qui existe (nombre d'outils
  MCP, écrans livrés, migrations appliquées) se périme au commit suivant sans que rien ne
  le signale, et une IA le croit au lieu d'aller lire. Ce qui est fait se lit dans le code,
  ce qui reste à faire dans les issues ouvertes.
- **Avant de toucher un geste du domaine, lire le service qui le porte** dans
  `packages/core/src/services/`. Son commentaire d'en-tête dit ce que le geste garantit et
  ce qu'il refuse : le contrat vit là, en anglais comme tout commentaire, pas dans un
  document à part qui se périmerait en silence.

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

## Flux de travail

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
- **Aucune sauvegarde Postgres** sur le socle, et ces données ne sont pas recollectables.
  Risque assumé, suivi par l'issue #14 : ne pas le redécouvrir à chaque session, ne pas le
  retrancher seul.
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

