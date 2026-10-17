---
description: "Execute the implementation plan, every code task going through the test-first loop."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent, en particulier sur les
étapes 4, 6 et 7.

- **Chaque tâche de code passe par la skill `test-first`** : tests écrits par
  `test-writer`, relus par `test-reviewer` en contexte neuf, instantané de la garde,
  code écrit par `implementer`, audit par `test-auditor`. Le plan dont parle la skill,
  c'est `spec.md` (dont « Cas et refus ») et `plan.md` du cache de l'issue, plus les
  tâches traitées. Une boucle par user story, sur l'ensemble de ses tâches de code ;
  une tâche sans code (documentation, configuration) se fait directement.
- **Ne crée ni ne complète aucun fichier d'ignore** (étape 4) : ce dépôt les tient
  lui-même, et une tâche qui en a besoin le dit.
- Les tâches terminées se cochent dans `tasks.md` du cache ; le hook
  `after_implement` les renvoie dans l'issue.
- Le tableau de la garde des tests, quand un test a changé, va dans la description
  de la PR, jamais dans un fichier du dépôt.
- La suite complète et les vérifications du dépôt entier tournent en CI : en local,
  seuls les tests de ce qui a été modifié.

{CORE_TEMPLATE}
