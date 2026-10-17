---
description: "Assess a bug report against the codebase and record the diagnosis in the bug's GitHub issue."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent.

- **Un bug a son issue GitHub** (type `Bug`), source de son diagnostic. Pas d'issue :
  la créer d'abord avec la skill `intent`.
- **Le slug est le numéro de l'issue** : `BUG_DIR` vaut `.specify/bugs/<numéro>`,
  un cache ignoré par git. Avant tout, le reconstruire depuis l'issue :

  ```sh
  node .specify/extensions/issue-sync/scripts/issue-sync.mjs pull <numéro> \
    --dir .specify/bugs/<numéro> --prefix bug/
  ```

- **Le diagnostic est rédigé en français.** Le correctif ne commence pas ici : il
  passe par `/speckit-bug-fix`, qui reproduit d'abord le bug par un test.

{CORE_TEMPLATE}

## Après le diagnostic

Verser le diagnostic dans l'issue :

```sh
node .specify/extensions/issue-sync/scripts/issue-sync.mjs push <numéro> \
  --dir .specify/bugs/<numéro> --prefix bug/ --note "diagnostic : <verdict et cause en une phrase>"
```
