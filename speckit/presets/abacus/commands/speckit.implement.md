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
- **En fin d'étape, dire quelles revues relancer**, quand `converge` en a déjà fait. La
  revue de code, celle des tests et celle de sécurité se jugent chacune à part. Une
  revue déjà faite ne se refait que si l'étape a produit du code qu'elle n'a pas lu, et
  en quantité : un module, un flux ou une interface réécrits ; pour la sécurité, une
  surface nouvelle (authentification, saisie, dépendance, route). Corriger les
  trouvailles d'une revue, ou retoucher une petite partie du code, ne relance rien :
  relire du code déjà relu trouve des détails toujours plus fins et ne s'arrête jamais.
  En cas de doute, aucune. Le verdict, avec sa raison, s'écrit dans la note du dernier
  `/speckit-issue-sync-push` : « Revues à relancer : aucune », ou « Revues à relancer :
  code (le flux d'autorisation a été réécrit) ».

{CORE_TEMPLATE}
