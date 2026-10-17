---
description: "Apply a go / needs-clarification / kill gate and turn the verdict into the feature's GitHub issue."
---

{CORE_TEMPLATE}

## Règles d'abacus : le verdict devient une issue

La réflexion n'a de valeur que retrouvable : l'issue est sa source, le dossier
`.specify/assessments/<slug>/` n'est qu'un cache ignoré par git. Les artefacts sont
rédigés en français.

- **needs-clarification** : rien à créer, la réflexion continue.
- **go** ou **kill** :
  1. Chercher les précédents (`gh issue list --state all --search "<mots-clés>"`).
     Une issue ouverte couvre déjà le sujet : la réflexion va dans celle-là. Une
     issue fermée l'a écarté : la nouvelle dit ce qui a changé depuis.
  2. Rédiger l'issue selon la skill `intent` (Intention, Pourquoi, Cadre, Fin),
     depuis `decision.md` et `problem.md`. Montrer titre et corps à l'utilisateur,
     et créer l'issue sur son accord.
  3. Y verser la réflexion, un commentaire par artefact :

     ```sh
     node .specify/extensions/issue-sync/scripts/issue-sync.mjs push <numéro> \
       --dir .specify/assessments/<slug> --prefix assess/ --note "réflexion préalable : <verdict>"
     ```

  4. **kill** seulement : fermer l'issue avec son motif, jamais en silence :
     `gh issue close <numéro> --reason "not planned" --comment "<motif décisif>"`.
- **go** : l'étape suivante est `/speckit-specify` sur la branche
  `<type>/<numéro>-<slug>` de cette issue.
