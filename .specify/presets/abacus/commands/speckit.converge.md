---
description: "Judge the feature finished from the outside: Spec Kit check, code review, security review, functional and human validation."
---

## Règles d'abacus pour cette étape

`converge` juge la fonctionnalité finie, vue de l'extérieur. La vérification Spec Kit
ci-dessous n'est que la première de cinq étapes ; les quatre suivantes viennent après
elle, dans la section « Suite de la convergence ».

{CORE_TEMPLATE}

## Suite de la convergence

Si la vérification Spec Kit a ajouté des tâches, s'arrêter là : la prochaine étape
est `/speckit-implement`, puis `/speckit-converge` de nouveau.

Sinon, enchaîner dans cet ordre, sans modifier de code (une trouvaille devient une
tâche, jamais un correctif direct) :

1. **Revue de code** : `/code-review` au niveau déclaré par la section « Revue » du
   plan, sans `--fix`.
2. **Revue de sécurité** : `/security-review`, quand la section « Revue » du plan la
   rend obligatoire.
3. **Validation fonctionnelle** : jouer les scénarios de la spec à travers les vraies
   interfaces (navigateur sur le web, MCP local), et déposer la preuve dans la PR
   (captures dans l'état qui montre le changement, échange avec le MCP).
4. **Validation humaine** : présenter à l'utilisateur la fonctionnalité ouverte dans
   l'état qui la montre, et attendre son verdict.

Chaque trouvaille s'ajoute à `tasks.md` sous une nouvelle phase « Convergence », au
format de la vérification Spec Kit (`<source-ref>` : `code-review`,
`security-review`, `validation`, `humain`). Elle suit le chemin que la skill
`test-first` donne à sa nature : un bug repasse par un test qui le reproduit, un
défaut de qualité par l'implémenteur, un plan faux par la spec et le plan d'abord.
Puis renvoyer les tâches dans la description de la PR (`/speckit-issue-sync-push`),
et reprendre
`/speckit-implement` puis `/speckit-converge`. Après une petite retouche, revalider
ce qui a été touché ; après un changement structurant, tout.

La fonctionnalité n'est « convergée » que lorsqu'aucune des cinq étapes ne trouve
plus rien.

**Amélioration continue** : pour chaque trouvaille qui pourrait revenir au-delà de
cette fonctionnalité, se demander ce qui l'aurait évitée (un contrôle d'abord, sinon
une règle dans l'`AGENTS.md` le plus proche, sinon rien) et le proposer. Une règle
dont la cause a disparu se met à jour ou se retire.
