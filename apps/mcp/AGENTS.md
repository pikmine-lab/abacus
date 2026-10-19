# Serveur MCP

L'IA qui consomme ce serveur n'a jamais accès au dépôt : les définitions d'outils (noms,
descriptions, erreurs) sont son seul monde. Une description d'outil se travaille comme un
écran, et une erreur de l'IA en usage réel se traite comme un défaut d'interface.

## Autorisation

Le serveur s'autorise par OAuth, sans clé. Le client ajoute l'URL du serveur, ouvre abacus
dans le navigateur, l'utilisateur se connecte et consent, et le client reçoit un jeton
d'accès de dix minutes lié à cette URL exacte, renouvelé par son jeton de
rafraîchissement. L'écran **Brancher une IA** (menu du compte) dit ce que chaque client
attend et liste les applications à révoquer : c'est la source à jour, ne pas recopier de
commande ici.

Un client s'identifie par l'URL du document de métadonnées qu'il publie (CIMD), ou, sinon,
par un `client_id` préenregistré dans `packages/core/src/oauth-clients.ts`, un client public
par assistant. L'enregistrement dynamique reste fermé, et un client qui exige un secret ne
se branche pas.

## En local

Le serveur de production (`abacus-mcp.payangar.dev`) porte des données réelles : un
changement se vérifie contre le serveur local et le compte de démo, jamais contre lui.

Pour éprouver le flux OAuth avec un vrai client, lancer le serveur sur le `MCP_URL` du
worktree, depuis la racine :

```sh
MCP_ALLOWED_HOSTS=<hôte de MCP_URL> NODE_OPTIONS=--use-system-ca \
  portless <branche>-mcp.abacus node --env-file=apps/web/.env.local apps/mcp/src/main.ts
```

L'option CA lui fait lire les clés du web derrière le HTTPS local.
