---
description: "Execute the implementation plan, every code task going through its own test-first loop."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent, en particulier sur les
étapes 4, 6 et 7.

- **Une boucle test-first par tâche de code**, avec la skill `test-first` : tests
  écrits par `test-writer`, relus par `test-reviewer` en contexte neuf, instantané de
  la garde, code écrit par `implementer`, audit par `test-auditor`. Le plan que la
  boucle reçoit : les cas que la tâche cite (lignes de « Cas et refus » de `spec.md`),
  leur niveau dans la « Stratégie de test » de `plan.md`, et la tâche elle-même. Une
  tâche marquée « (sans code) » se fait directement.
- **Ne crée ni ne complète aucun fichier d'ignore** (étape 4) : ce dépôt les tient
  lui-même, et une tâche qui en a besoin le dit.
- Les tâches terminées se cochent dans `tasks.md` du cache ; le hook
  `after_implement` les renvoie dans la description de la PR.
- Le tableau de la garde des tests, quand un test a changé, va dans la description
  de la PR, hors de la section des tâches, jamais dans un fichier du dépôt.
- La suite complète et les vérifications du dépôt entier tournent en CI : en local,
  seuls les tests de ce qui a été modifié.

{CORE_TEMPLATE}
