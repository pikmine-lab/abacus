
## Stratégie de test *(obligatoire)*

<!--
  Chaque cas de « Cas et refus » a son niveau de test, choisi ici avant toute tâche :
  le plus bas qui l'éprouve vraiment. Niveaux : calcul pur du domaine, service contre
  la base, outil MCP en process, écran. Ce qui ne se teste pas automatiquement dit
  comment il se valide (validation fonctionnelle de converge).
-->

| Cas | Niveau | Ce que le test exerce |
|---|---|---|
| C1 | [service] | [le geste, l'état de départ, ce qui est vérifié] |

- **Données** : [ce que les tests ajoutent à leurs jeux de départ ; ce que le jeu de démo
  gagne pour la validation fonctionnelle]
- **Hors automatisation** : [cas, et comment il se valide]

## Revue *(obligatoire)*

- **`/code-review`** : niveau `[low | medium | high | xhigh | max]`, choisi selon la taille
  de la fonctionnalité et ce qu'elle touche. [Une phrase : pourquoi ce niveau.]
- **`/security-review`** : [obligatoire | non requise]. [La raison : un champ saisi, une
  route, une règle d'accès, un secret, une dépendance ajoutés la rendent obligatoire.]

Un humain ou un agent peut relever ces niveaux en cours de route ; la modification se
fait ici, avec sa raison.

## Écarts à la constitution *(obligatoire)*

<!--
  Un écart dans ce que la fonctionnalité modifie (la fonction, la route, la table
  touchée) bloque : il se corrige dans cette PR, ou la convergence se fait d'abord.
  Un écart déjà connu dans du code que la fonctionnalité ne touche pas se liste avec
  l'issue de convergence qui le porte. Écrire « Aucun » plutôt que laisser vide.
-->

| Principe | Où | Traitement |
|---|---|---|
| [ex. V] | [fichier, fonction] | [corrigé dans cette PR / hors périmètre, issue #] |
