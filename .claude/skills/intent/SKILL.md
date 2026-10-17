---
name: intent
description: >
  Point d'entrée d'une idée, d'une fonctionnalité ou d'un bug sur abacus : la capturer
  en issue GitHub, ou la passer d'abord par une réflexion (`/speckit-assess-intake`)
  quand elle le demande ; puis rédiger, relier et clore l'issue. Utiliser quand Pierre
  décrit une intention qu'il ne traite pas tout de suite, dit « trace ça », « crée un
  ticket », « note-le pour plus tard », « est-ce qu'on devrait… », avant d'ouvrir une
  branche sur un sujet sans issue, ou pour fermer une issue abandonnée.
---

# Intention

L'issue n'organise pas le travail (Todoist le fait) : elle **garde le pourquoi**, et
porte les artefacts Spec Kit de la fonctionnalité (spec, plan, tâches), un commentaire
par artefact. Elle est écrite pour être relue dans six mois par quelqu'un, humain ou
IA, qui n'a pas assisté à la conversation d'aujourd'hui. Le dépôt est public : rien de
personnel dans une issue.

## 1. Chercher les précédents

```sh
gh issue list --state all --search "<mots-clés>"
```

Sujet couvert par une issue ouverte : commenter celle-là. Écarté par une issue fermée :
la nouvelle dit ce qui a changé depuis.

## 2. Capturer ou réfléchir

- **Capture directe** quand l'intention est claire et son intérêt évident : une issue
  en quelques lignes, sans rien concevoir. Une capture coûte presque rien ; ne pas la
  retarder pour la parfaire.
- **Réflexion d'abord** (`/speckit-assess-intake`, puis `research`, `define`, `shape`,
  `decide`) quand l'intérêt, le problème réel ou la forme de la solution sont
  incertains, ou que l'idée engage le modèle de données. Le verdict crée l'issue (go),
  la crée puis la ferme avec son motif (kill), ou renvoie à une étape
  (needs-clarification).

Proposer l'une ou l'autre à Pierre, avec la raison en une phrase ; il tranche.

## 3. Rédiger

Titre : une phrase d'intention ou de constat, pas un nom de composant. « Le tableau de
bord ne dit pas ce qui reste à payer ce mois » plutôt que « KPI dashboard ».

Corps, en français :

```md
## Intention
Ce qu'on veut obtenir, en deux ou trois phrases.

## Pourquoi
Ce qui a déclenché l'idée, ce que son absence coûte aujourd'hui. La seule section
qu'on ne peut pas reconstituer plus tard.

## Cadre
Ce qui est déjà tranché ailleurs et s'applique (pointer, ne pas recopier), ce qui est
hors périmètre, les pistes écartées et leur motif.

## Fin
À quoi on voit que c'est fait : un critère observable, pas une liste de tâches.
```

`Intention` et `Pourquoi` sont dus dès la capture. `Cadre` et `Fin` peuvent attendre
l'instruction : ne pas les inventer pour faire propre. Les comportements, cas et refus
détaillés n'ont pas leur place ici : ils naissent dans la spec (`/speckit-specify`).

Montrer titre et corps à Pierre avant de créer.

## 4. Types et liens

Les types viennent de l'organisation : `Feature`, `Bug`, `Task`.

```sh
gh issue create --type Feature --title "…" --body-file <fichier>
gh issue create --parent <n> …           # sous-issue d'un chantier
gh issue edit <n> --add-blocked-by <m>   # ne peut pas démarrer avant m
```

Une causalité n'a pas de relation native : l'écrire dans le corps en citant l'issue
**et** la PR (« Régression introduite par #12, PR #34 »).

## 5. Attaquer, clore

- Branche `<type>/<numéro>-<slug>`, slug en anglais (`feat/12-monthly-due-dates`) :
  `issue-sync` y lit le numéro. Puis `/speckit-specify` pour une fonctionnalité,
  `/speckit-bug-assess` pour un bug. La PR close l'issue (`Closes #12`).
- Une tâche Todoist qui double une issue la référence (`abacus #12 : titre`), sans
  recopier son contenu.
- Une issue abandonnée se ferme avec son motif, jamais en silence :
  `gh issue close <n> --reason "not planned" --comment "…"`. Ce commentaire évite de
  reproposer la même chose dans un an.
