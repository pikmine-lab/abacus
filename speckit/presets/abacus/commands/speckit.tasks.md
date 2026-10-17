---
description: "Generate the dependency-ordered tasks of the feature, whose tests come from the test-first loop."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent.

- **Le dossier de la fonctionnalité est le cache de son issue**, reconstruit par le
  hook `before_tasks`. `tasks.md` s'y écrit et rejoint l'issue après l'étape.
- **Les tests ne sont jamais optionnels**, quoi qu'en dise le gabarit. Ils ne font
  pas pour autant l'objet de tâches à part : à l'implémentation, chaque tâche de code
  passe par la boucle test-first, dont un agent dédié écrit les tests depuis la spec
  et le plan. Une tâche de code dit donc quels comportements et quels refus de
  « Cas et refus » elle couvre.
- Le jeu de démo (`packages/data-seed`) s'enrichit dans la même fonctionnalité dès
  qu'elle ajoute de quoi déclarer : c'est une tâche.

{CORE_TEMPLATE}
