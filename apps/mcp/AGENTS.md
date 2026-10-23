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

Un worktree lance son serveur sur son `MCP_URL` à sa création (`.config/wt.toml`). Une
session Claude Code ouverte dans le worktree le voit sous le nom `abacus` (`.mcp.json`),
qui masque le serveur de production de même nom.
