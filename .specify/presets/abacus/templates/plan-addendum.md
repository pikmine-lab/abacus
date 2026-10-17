
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
