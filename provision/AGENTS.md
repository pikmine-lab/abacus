# Déploiement

Chaque commit sur `main` déclenche tests, build des deux images puis déploiement Dokploy
(`.github/workflows/ci.yml`). Le dépôt embarque son provisionneur (`provision/`, zéro
dépendance, idempotent, API Dokploy uniquement), que la CI rejoue avec le tag `sha-…`
fraîchement construit.

- **Le provisionneur ne supprime jamais rien.** `node provision/src/provision.ts --dry-run`
  montre l'écart sans agir ; en local, ses variables viennent d'un `.env` de `provision`,
  jamais commité.
- **Rollback** : relancer le provisionneur avec un tag antérieur
  (`IMAGE_TAG=sha-… node src/provision.ts` depuis `provision/`, tags visibles sur GHCR).
- **Images** : `ghcr.io/pikmine-lab/abacus-web` (Next standalone) et `abacus-mcp`, qui migre
  la base à son démarrage sous verrou advisory. Tags `sha-<court>` immuables, plus `latest`.
- **Stack** : `deploy/docker-compose.yml`, projet Dokploy `abacus`, réseau
  `dokploy-network`, domaines `abacus.payangar.dev` (web) et `abacus-mcp.payangar.dev`
  (MCP), TLS Let's Encrypt via Traefik. Base et rôle `abacus` sur le Postgres partagé du
  socle, créés une fois hors provisionneur.
- **Sauvegardes** : la base de production est sauvegardée par le socle, chaque jour et
  chaque semaine ; leur déclaration est dans `vendors/infra`.

## Secrets

Dans le vault Infisical du socle, aucun dans GitHub. Le dépôt est public : ni secret, ni
topologie serveur ici.

- Le job `deploy` échange son jeton OIDC contre un accès au vault
  (`provision/src/vault.ts`), sous l'identité dont l'id est la variable de dépôt
  `INFISICAL_IDENTITY_ID`. Cette identité n'accepte qu'un jeton signé pour `main` de ce
  dépôt : le job ne déclare donc pas d'`environment`, qui changerait le sujet du jeton.
- Il lit `DOKPLOY_URL` et `DOKPLOY_TOKEN` dans le projet `ci`, dossier `/apps`, puis
  `DATABASE_URL` et `BETTER_AUTH_SECRET` dans le projet `abacus`. Une variable qui n'est
  pas secrète reste dans le provisionneur (`SPEC`).
- Variables des conteneurs : `DATABASE_URL`, `PUBLIC_URL`, `BETTER_AUTH_SECRET`
  (obligatoire en production, sinon crash à la première requête), `PORT` (MCP), `MCP_URL`
  (web : l'endpoint MCP donné à l'utilisateur, écrit par le provisionneur depuis `SPEC`).
