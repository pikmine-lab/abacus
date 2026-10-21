# speckit

Le dossier de travail de ce que Spec Kit fait autrement dans abacus. Toute modification de
l'extension `issue-sync` ou du preset `abacus` se fait ici, et seulement ici.

## Ce qu'il contient

- **`extensions/issue-sync/`** garde les artefacts d'une fonctionnalité sur GitHub : spec et
  plan en commentaires de son issue, tâches dans la description de sa PR. Avant chaque
  étape, il les recopie dans un cache local ignoré par git ; après, il les renvoie. Son
  script est testé (`test/`), et ces tests tournent avec le script `test` du dépôt.
- **`presets/abacus/`** adapte les commandes et les gabarits de Spec Kit aux règles du
  dépôt : cas et refus numérotés dans la spec, stratégie de test et niveau de revue dans le
  plan, des tâches qui écrivent leurs tests avant leur code, `converge` par la revue du code
  et des tests jusqu'à la validation humaine.

## Ce qui en est généré

La réinstallation copie ces sources sous `.specify/` (`extensions/issue-sync/`,
`presets/abacus/`) et en produit les skills `.claude/skills/speckit-*`. Ces copies sont
versionnées pour qu'un clone n'ait rien à installer, mais elles ne se modifient pas à la
main : la réinstallation suivante écraserait la modification, et la source resterait
fausse.

## Modifier

1. Modifier la source ici.
2. Réinstaller, à la version de Spec Kit inscrite dans `.specify/init-options.json` :

   ```sh
   uvx --from specify-cli==<version> specify extension add --dev ./speckit/extensions/issue-sync --force
   uvx --from specify-cli==<version> specify preset update abacus --dev ./speckit/presets/abacus
   ```

3. Lancer `nr lint:fix` : la réinstallation réécrit `.claude/settings.json` dans un format
   que Biome refuse.
4. Committer ensemble la source et tout ce que la réinstallation a régénéré.
