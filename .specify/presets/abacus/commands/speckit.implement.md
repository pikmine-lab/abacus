---
description: "Execute the implementation plan, every code task writing its tests before its code."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent, en particulier sur les
étapes 4, 6 et 7.

- **Une tâche de code écrit ses tests avant son code**, dans la même session : les
  tests des cas qu'elle cite (lignes de « Cas et refus » de `spec.md`), au niveau que
  leur donne la « Stratégie de test » de `plan.md`, lancés et vus échouer pour la
  raison attendue ; puis le code qui les fait passer. Une tâche marquée « (sans code) »
  se fait directement.
- **Un test existant ne change qu'avec une raison qui lui est propre**, écrite dans la
  description de la PR, hors de la section des tâches, jamais dans un fichier du dépôt.
- **Ne crée ni ne complète aucun fichier d'ignore** (étape 4) : ce dépôt les tient
  lui-même, et une tâche qui en a besoin le dit.
- Les tâches terminées se cochent dans `tasks.md` du cache, et chaque commit est
  suivi de `/speckit-issue-sync-push`, qui les renvoie dans la description de la PR :
  la PR montre où en est l'implémentation, même quand l'étape s'interrompt. Le hook
  `after_implement` fait le dernier envoi.
- La suite complète et les vérifications du dépôt entier tournent en CI : en local,
  seuls les tests de ce qui a été modifié.

{CORE_TEMPLATE}
