---
name: issue-tracking
description: >
  Suivi du projet par issues GitHub : tracer une intention sans la traiter tout de
  suite, l'instruire quand on l'attaque, la relier à ce qui l'a causée ou à ce qu'elle
  a cassé, la clore. Utiliser quand Pierre décrit une fonctionnalité, un bug ou une
  idée qu'il ne veut pas traiter dans la session, dit « trace ça », « crée un ticket »,
  « note-le pour plus tard », quand il faut retrouver pourquoi une décision a été
  prise, ou avant d'ouvrir une branche sur un sujet qui n'a pas encore son issue.
---

# Suivi par issues

Une issue n'existe pas pour organiser le travail (Todoist le fait) mais pour **garder le
pourquoi**. Le code dit ce qui est fait, l'historique git dit quand, l'issue est le seul
endroit qui garde l'intention, ce qui a été écarté, et ce qui a causé quoi. Elle est
écrite pour être relue dans six mois, par Pierre ou par une IA qui n'a pas assisté à la
conversation d'aujourd'hui.

Deux conséquences :

- Une issue capturée en trois lignes vaut mieux qu'une issue parfaite jamais créée. La
  capture doit rester à coût quasi nul.
- Rien de personnel dans une issue : le dépôt est public. Le principe « le cas d'usage
  de Pierre n'entre jamais dans le code » vaut aussi pour les issues.

## Avant de créer

Chercher les précédents : une intention est souvent la reformulation d'une chose déjà
tranchée, ou déjà écartée.

```sh
gh issue list --state all --search "<mots-clés>"
```

Sujet déjà couvert par une issue ouverte : commenter celle-là. Écarté par une issue
fermée : la nouvelle doit dire ce qui a changé depuis.

## La forme

Titre : une phrase d'intention, pas un nom de composant. « Le tableau de bord ne dit pas
ce qui reste à payer ce mois » plutôt que « KPI dashboard ».

Corps, dans la langue du dépôt (français ici, comme AGENTS.md et DESIGN.md) :

```md
## Intention
Ce qu'on veut obtenir, en deux ou trois phrases.

## Pourquoi
Le besoin réel derrière : ce qui a déclenché l'idée, ce que son absence coûte
aujourd'hui. Seule section irremplaçable, c'est celle qu'on ne peut pas reconstituer
plus tard.

## Cadre
Ce qui est déjà tranché ailleurs et s'applique (pointer le fichier et la section : la
migration ou le service pour une règle du domaine, DESIGN.md pour l'apparence,
apps/web/AGENTS.md pour le front ; ne pas recopier), ce qui est hors périmètre, les
pistes écartées et leur motif.

## Fin
À quoi on voit que c'est fait. Un critère observable, pas une liste de tâches.
```

`Intention` et `Pourquoi` sont dus dès la capture. `Cadre` et `Fin` peuvent rester vides
et se remplir à l'instruction : ne pas retarder une capture pour eux, ne pas les
inventer pour faire propre.

## Capture puis instruction

Deux moments distincts, et les confondre est le principal risque.

- **Capture** (Pierre décrit une intention qu'il ne traite pas maintenant) : proposer
  l'issue, l'écrire en quelques lignes, ne rien concevoir. Pas d'analyse technique, pas
  de découpage, pas de choix d'implémentation : ils seraient faux au moment de
  l'attaquer, et feraient autorité à tort.
- **Instruction** (on décide de la faire) : relire l'issue, la compléter en commentaire
  ou en éditant le corps, et seulement là poser les décisions techniques. Puis la
  branche. Si le travail est planifié, la tâche Todoist référence l'issue
  (`abacus #12 : titre`), elle n'en recopie pas le contenu.

## Types et liens

Les types viennent de l'organisation, ce ne sont pas des labels : `Feature`, `Bug`,
`Task`.

```sh
gh issue create --type Feature --title "…" --body-file <fichier>
gh issue edit <n> --type Bug
```

Les relations sont natives, les préférer à la prose :

```sh
gh issue create --parent <n> …           # sous-issue d'un chantier
gh issue edit <n> --add-blocked-by <m>   # ne peut pas démarrer avant m
gh issue edit <n> --add-blocking <m>     # l'inverse
```

Une causalité n'a pas de relation dédiée sur GitHub : l'écrire dans le corps en citant
l'issue **et** la PR (« Régression introduite par #12, PR #34 »). La mention crée le
lien retour automatiquement.

## Branche, PR, clôture

Branche `<type>/<numéro>-<slug>`, slug en anglais (`feat/12-monthly-due-dates`) : le
numéro laisse la skill `pr-review-supervised` retrouver l'issue de suivi seule. La PR la
close (`Closes #12` dans sa description).

Une issue abandonnée se ferme avec son motif, jamais en silence :

```sh
gh issue close <n> --reason "not planned" --comment "…"
```

Ce commentaire compte autant que l'issue : la trace d'un refus évite de reproposer la
même chose dans un an.
