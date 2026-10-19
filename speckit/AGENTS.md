# Sources Spec Kit d'abacus

- Ce dossier est la seule source de l'extension `issue-sync` et du preset `abacus`. Leurs
  copies sous `.specify/` et les skills `.claude/skills/speckit-*` sont générées : ne jamais
  les modifier à la main.
- Après une modification, réinstaller et committer comme le dit `speckit/README.md`.
- Une modification du script d'`issue-sync` passe par la boucle test-first : ses tests
  sont dans `extensions/issue-sync/test/`.
