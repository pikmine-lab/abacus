# abacus

Application web de gestion de finances personnelles, multi-utilisateur, self-hosted : ce
qui est dépensé aujourd'hui, ce à quoi on est engagé demain, les placements et l'activité
freelance. Pierre est le premier utilisateur, pas un cas particulier du code. Rigueur
durable : ce projet est fait pour tenir, pas pour démontrer.

## Lire avant d'agir

- **La constitution** (`.specify/memory/constitution.md`) porte les principes qu'un agent
  respecte quand il spécifie, planifie, écrit ou juge du code, chacun avec sa
  vérification. La lire avant de concevoir ou de juger un changement.
- **Le modèle de domaine se lit dans le code** : les migrations (`migrations/*.sql`) pour
  ce que le schéma garantit, les services (`packages/core/src/services/`) pour ce que
  chaque geste fait et refuse. Avant de toucher un geste, lire l'en-tête de son service.
- **L'interface** : `DESIGN.md` pour l'apparence, `PRODUCT.md` pour la direction,
  `apps/web/AGENTS.md` pour le code du front. Un écran se compose avec la skill
  Impeccable, depuis son brief dans `apps/web/.impeccable/surfaces/`.
- **L'infrastructure** sur laquelle tourne abacus (base partagée, vault, sauvegardes,
  modules communs) est décrite dans le sous-module `vendors/infra` ; le déploiement de
  l'application, dans `provision/AGENTS.md`.

## Où s'écrit une décision

Chaque chose a un endroit et un seul : deux fichiers qui disent la même chose finissent
par se contredire, et c'est le périmé qu'on croit.

| Ce qui vient d'être décidé | Où ça s'écrit |
|---|---|
| Un principe qu'un agent respecte en écrivant ou en jugeant du code | La constitution |
| Un invariant du modèle : ce qu'une donnée garantit | En commentaire de la migration qui le pose |
| Une règle de geste : ce qui se déclare, se corrige, se refuse | En commentaire du service de `packages/core` qui la porte |
| La direction du produit | `PRODUCT.md` |
| Une règle d'apparence : couleur, densité, graphe, ton | `DESIGN.md` |
| La composition d'un écran | Son brief, `apps/web/.impeccable/surfaces/` |
| Une règle de code propre à une partie du dépôt | L'`AGENTS.md` le plus proche de ce qu'elle gouverne |
| Ce qu'une fonctionnalité doit faire : spec, plan | Son issue, un commentaire par artefact Spec Kit |
| Comment elle se fait : les tâches | La description de sa PR |
| Le récit : ce qui a été mesuré, écarté, ce qui a causé quoi | L'issue |

Ces fichiers décrivent l'état actuel, au présent : ni date ni numéro d'issue en guise
d'histoire, ni inventaire de ce qui existe. Une décision qui en corrige une autre la
remplace. Un renvoi vers une issue ouverte reste légitime.

## Issues et cycle d'une fonctionnalité

Toute intention se trace en issue GitHub, même quand personne ne l'attaque tout de suite :
la skill `intent` capture, rédige et clôt. Avant de travailler un sujet, chercher ses
précédents, ouverts comme fermés (`gh issue list --state all --search …`).

Une fonctionnalité suit le cycle Spec Kit adapté au dépôt : `/speckit-specify`,
`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`,
`/speckit-converge`. Un bug passe par `/speckit-bug-assess` puis `/speckit-bug-fix`. La
branche se nomme `<numéro de l'issue>-<slug>`, et sa PR close l'issue.

**Lire une fonctionnalité** :

- le corps de l'issue porte l'intention (Intention, Pourquoi, Cadre, Fin) ;
- un commentaire de l'issue qui commence par `<!-- speckit-artifact: … -->` est un
  artefact (spec, plan…), et fait foi : le cache local, ignoré par git, n'en est qu'une
  copie reconstruite à chaque étape ; `assess/…` est la réflexion préalable, `bug/…` le
  diagnostic ;
- les tâches sont dans la description de la PR, entre les marqueurs `speckit-tasks` ;
- les commentaires « Spec Kit : … » disent ce que chaque étape a changé, les autres
  portent la discussion et le récit ;
- les commentaires se lisent dans l'ordre : quand deux décisions se contredisent, la plus
  récente l'emporte.

**Accord d'écriture** : les commandes Spec Kit écrivent dans l'issue et la PR de la
fonctionnalité en cours, par l'extension `issue-sync`, et ouvrent cette PR en brouillon,
sans demander. L'accord ne couvre que ces deux-là et ce canal : toute autre issue ou PR
se demande.

Spec Kit est versionné : un clone n'a rien à installer. Ce qu'abacus y ajoute
(`issue-sync`, preset `abacus`) se modifie dans `speckit/`, jamais sous `.specify/`.

## Stack

- **Next.js + Postgres** : instance partagée du socle, base et rôle `abacus`, jointe
  uniquement par `DATABASE_URL`, jamais par un nom d'hôte en dur.
- **Better Auth** pour l'authentification, tables préfixées `auth_*`. L'application web est
  aussi le serveur d'autorisation OAuth du MCP (plugins `jwt`, `mcp`, `cimd`) ; ses
  versions sont épinglées, et le code d'abacus ne passe que par ses points d'extension.
- **SQL à la main** : datasources CRUD sans métier prenant un `Executor` (pool ou
  transaction), la transaction appartenant à la couche service.
- **Migrations** `migrations/*.sql`, forward-only, appliquées par `nr migrate` (verrou
  advisory, une transaction). Une migration présente sur `main` ne se modifie plus.
- **Monorepo pnpm** : `packages/core` (domaine, services, datasources), `apps/web`,
  `apps/mcp` (`apps/mcp/AGENTS.md`), `packages/data-seed` (jeu de démo local).

## Développement local

Base Postgres jetable en Docker, iso socle (même image, rôle et base `abacus`, extensions
créées par `scripts/dev-db-init.sql`). Jamais de travail sur la base de production en local.

```sh
nr db:up         # démarre la base (port local 5544)
nr migrate:dev   # applique les migrations dessus
nr data:seed     # réécrit le compte de démo dans la base qu'ouvre l'app
nr db:reset      # recrée, migre et sème la base de ce worktree seulement
nr db:down -v    # détruit le volume et toutes les bases, worktrees compris
```

**Le compte de démo remplit chaque écran** : `demo@abacus.local`, mot de passe
`demo-abacus`. `packages/data-seed` le réécrit en entier, par les services de
`packages/core`, à chaque création de worktree et à chaque `nr data:seed` ; ce qui y est
saisi à la main disparaît, une base non locale est refusée. Une fonctionnalité qui ajoute de
quoi déclarer enrichit ce jeu dans la même PR, avec des noms inventés.

L'app web se lance avec `pnpm --filter @abacus/web dev` et lit le `.env.local` d'`apps/web`
(non commité) : `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PUBLIC_URL` et `MCP_URL`, sans
laquelle elle ne démarre pas. Un worktree reçoit le sien à sa création (`.config/wt.toml`).

## Flux de travail

- **`main` est la production**, déployée en continu. Tout passe par une PR dont la CI est
  verte, et le merge passe par la file d'attente de GitHub (« Merge when ready »).
- **Pas de commit direct sur `main`.** Le contournement administrateur du ruleset est
  désactivé ; le réactiver est un geste humain délibéré, qu'un agent ne fait jamais.
- La suite complète, le typecheck et le build tournent en CI ; en local, seuls les tests
  de ce qui a été modifié. Lancer `nr lint` sans pipe avant de committer : `| tail` masque
  son code de sortie.
- Après une trouvaille qui pourrait revenir au-delà du travail en cours, se demander ce qui
  l'aurait évitée : un contrôle d'abord, sinon une règle dans l'`AGENTS.md` le plus proche,
  sinon rien. Quand un changement retire la cause d'une telle règle, la mettre à jour ou
  la retirer.
