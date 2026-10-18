---
description: "Generate the dependency-ordered tasks of the feature as test-first batches, kept in its pull request."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent.

- **Les tâches vivent dans la description de la PR** de la fonctionnalité, dans une
  section que `issue-sync` tient à jour ; le `tasks.md` du cache n'en est qu'une copie.
  Avant de terminer l'étape (et donc avant le hook `after_tasks`), ouvrir la PR en
  brouillon si la branche n'en a pas :

  ```sh
  git commit --allow-empty -m "chore: open <issue number>"   # seulement si la branche n'a aucun commit
  git push -u origin HEAD
  gh pr create --draft --title "<titre de l'issue>" --body "Closes #<issue number>"
  ```

- **Chaque tâche de code est un lot test-first** : elle cite les cas de « Cas et
  refus » qu'elle couvre et leur niveau de test, pris dans la « Stratégie de test »
  du plan. Jamais de tâche « écrire les tests » à part : à l'implémentation, la boucle
  test-first de chaque tâche écrit ses tests. Les règles complètes sont à la fin du
  gabarit des tâches.
- Chaque cas de « Cas et refus » est couvert par au moins une tâche ; un cas sans
  tâche est un trou du plan, à reprendre avant de continuer.
- Le jeu de démo (`packages/data-seed`) s'enrichit dans la même fonctionnalité dès
  qu'elle ajoute de quoi déclarer : c'est une tâche.

{CORE_TEMPLATE}
