# Spec Kit installé

Ce dossier est écrit par le CLI Spec Kit : rien ne s'y modifie à la main, sauf la
constitution.

- **La constitution** (`memory/constitution.md`) est la seule source de ce dossier. Elle se
  modifie ici, par PR.
- **L'extension `issue-sync` et le preset `abacus`** se modifient dans `speckit/`, puis se
  réinstallent : voir `speckit/README.md`. Une modification faite sous `.specify/` serait
  écrasée à la réinstallation suivante.
- **Le reste** (scripts, gabarits, extensions officielles `assess` et `bug`) vient de Spec
  Kit et ne change qu'avec sa version.
