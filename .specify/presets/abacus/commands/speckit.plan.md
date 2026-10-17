---
description: "Execute the implementation planning workflow, declaring the review level and the constitution deviations."
---

## Règles d'abacus pour cette étape

Elles priment sur les instructions génériques qui suivent.

- **Le dossier de la fonctionnalité est le cache de son issue**, reconstruit par le
  hook `before_plan`. Le plan et ses compagnons (`research.md`, `data-model.md`,
  `contracts/`, `quickstart.md`) s'y écrivent et rejoignent l'issue après l'étape.
- **Le plan est rédigé en français.**
- **Section « Revue »** : le niveau d'effort de `/code-review` selon la taille de la
  fonctionnalité, et si `/security-review` est obligatoire, avec la raison. Elle est
  obligatoire dès que la fonctionnalité ajoute un champ saisi, une route, une règle
  d'accès, un secret ou une dépendance.
- **Section « Écarts à la constitution »** : chaque principe de
  `.specify/memory/constitution.md` est confronté à ce que la fonctionnalité modifie.
  Un écart dans le code touché (la fonction, la route, la table modifiée) bloque : le
  plan le corrige, ou s'arrête et propose de faire d'abord la convergence. Un écart
  connu dans du code non touché est listé avec l'issue de convergence qui le porte ;
  sans issue, la proposer.
- Avant de toucher un geste du domaine, lire le service qui le porte dans
  `packages/core/src/services/` : son commentaire d'en-tête est le contrat.

{CORE_TEMPLATE}
