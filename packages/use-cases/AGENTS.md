# Suite de cas d'usage

Elle fige ce qu'abacus fait : chaque cas est écrit une fois, en termes du domaine, et joué
sur chaque interface déclarée, le web dans un vrai navigateur et le MCP par ses outils.

## Écrire un cas

- **Un cas = un fichier** `cases/<module>/<objet>/<cas>.test.ts`, qui appelle
  `useCase('<domaine>.<objet>.<variante>', …)`. L'identifiant ne change plus.
- **Termes du domaine seulement** : ni écran, ni outil, ni table, ni fonction du back, ni
  texte affiché. Un cas n'importe que Node, `@abacus/use-case-language` et `src/play.ts`.
- **`arrange` prépare par le pilote de préparation**, qui passe par les services du back ;
  jamais par l'interface testée, jamais en base. `act` fait le geste et lit le résultat.
- **Une lecture compare des valeurs** (`Money` en chaîne décimale), pas un format. Le web
  arrondit plusieurs montants à l'euro : les cas prennent des montants ronds.
- **Un cas couvre le chemin nominal.** Les refus entrent dans la suite avec #192.

## Étapes, pilotes, inventaire

- Une étape se déclare dans `packages/use-case-language/src/steps/<domaine>.ts`. Appelée
  sous `act`, elle s'implémente dans les trois pilotes : `apps/web/driver`,
  `apps/mcp/driver`, `packages/core/driver`.
- Un geste ou une information qui naît entre dans `src/inventory/index.ts`, avec ce qui
  l'offre sur chaque interface, ou la raison pour laquelle une interface ne l'offre pas.
- Ajouter une interface : son pilote dans son dossier, sa déclaration dans `src/drivers.ts`,
  ses entrées dans l'inventaire. Ni les cas ni les gardes ne changent.

## Lancer

- `pnpm --filter @abacus/use-cases test` construit le web, joue tout et vérifie la
  couverture de l'inventaire.
- Pendant l'écriture d'un cas, la commande directe du script `test` sur un fichier, avec
  `ABACUS_CASES_REUSE_BUILD=1` (web déjà construit), `ABACUS_CASES_DRIVERS=web` ou `mcp`,
  et `ABACUS_CASES_ARTIFACTS=<dossier>` pour la capture d'une étape web qui échoue.
- Un cas instable par construction se marque `{ unstable: '<raison>' }` ; instable par
  accident, il se corrige.
