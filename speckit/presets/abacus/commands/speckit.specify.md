---
description: "Create or update the feature specification from the feature's GitHub issue."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent.

- **La fonctionnalité part de son issue GitHub**, qui est la source de tous ses
  artefacts. Pas d'issue : s'arrêter et la faire créer d'abord (skill `intent`).
- **Le dossier de la fonctionnalité est le cache de l'issue** que le hook
  `before_specify` (`issue-sync pull`) vient de reconstruire, sous `.specify/tmp/`.
  C'est la valeur de `SPECIFY_FEATURE_DIRECTORY` à l'étape 3 : ne rien créer sous
  `specs/`. Aucune branche n'est créée ici ; elle se nomme `<numéro de l'issue>-<slug>`.
- **La description de la fonctionnalité est l'issue** (`issue.md` du cache :
  Intention, Pourquoi, Cadre, Fin), complétée par ce que l'utilisateur a tapé. Si le
  cache contient une réflexion préalable (`assess/`), la spec en part.
- **La spec est rédigée en français**, comme les issues.
- **La section « Cas et refus » est remplie entièrement** : chaque comportement,
  chaque refus avec son code d'erreur nommé, chaque borne testée des deux côtés.
  Ce qui reste ouvert y est marqué `[NEEDS CLARIFICATION]`, jamais deviné.

{CORE_TEMPLATE}
