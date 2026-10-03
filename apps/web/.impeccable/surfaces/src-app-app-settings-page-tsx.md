---
version: 1
slug: "src-app-app-settings-page-tsx"
primary_target: "src/app/(app)/settings/page.tsx"
related_targets: ["src/app/(app)/settings/activities/[activityId]/page.tsx"]
---

Écran : Réglages (`src/app/(app)/settings/page.tsx`) et la page du régime d'une activité (`src/app/(app)/settings/activities/[activityId]/page.tsx`). Mode : Operate. Desktop et téléphone.
Question à laquelle il répond : comment l'application est réglée, et avec quel vocabulaire elle classe (catégories, activités, acteurs).
Usages : aucun ne domine, on vient régler une chose précise : réparer un acteur (alias, fusion, rattachement), ranger une catégorie dans un groupe, corriger une activité ou aller vers son régime, changer une préférence.
Contenu et gestes : ceux de l'écran avant refonte (#123), plus deux choses tranchées avec l'utilisateur : une activité mène à la page de son régime ; le groupe d'une catégorie se saisit avec les groupes existants proposés.
Tranché avec l'utilisateur : aucune partie ne s'étire sur la page, défaut principal de l'écran d'avant où chaque liste prenait toute sa longueur ; une partie à la fois, sa liste et la fiche de l'entrée choisie ; les gestes d'une entrée passent du menu ⋯ à sa fiche ; préférences refaites.

## Direction contract

THESIS: un réglage se trouve et se règle au même endroit. Une partie à la fois, sa liste dans son propre volet, la fiche de l'entrée choisie à côté, qui porte ses champs et ses gestes. Refuse la pile de sections qui s'allonge avec les données, les sous-titres qui expliquent, les formulaires d'ajout posés sous les listes et les gestes cachés derrière un menu de ligne.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, cuivre réservé à l'actif (le trait de l'onglet ouvert), la ligne choisie lavée à l'encre pleine, Geist et Geist Mono tabulaire, filets plutôt que cartes. La fiche vit sur le fond de page, séparée de la liste par un filet, rangée à droite comme le panneau de saisie des Mouvements.

STORY: la personne ouvre Acteurs, tape « mac » : la liste se réduit à l'acteur qui porte l'alias Macdo et le dit ; sa fiche montre ses alias, elle en ajoute un sur place. Elle passe à Catégories, lit chaque catégorie sous son groupe, en choisit une, tape « Lo » dans le groupe et prend « Logement » proposé. Elle ouvre une activité et suit « Régime » vers ses règles, organisées de la même façon.

FIRST VIEWPORT: en-tête « Réglages », le « + » de la partie ouverte au bout. Dessous, les onglets Catégories, Activités, Acteurs avec leur nombre, et Préférences, écrits dans l'URL. Desktop : à gauche (≈ 380 px) la liste, recherche en tête, défilant dans son volet à hauteur d'écran : catégories sous l'intertitre de leur groupe, acteurs avec leurs alias dessous ; la ligne choisie lavée, à l’encre pleine. À droite la fiche : le nom en titre, les champs préremplis et Enregistrer, puis les autres gestes en sections, le destructif en dernier. Sans entrée dans l'URL, la fiche est celle de la première ligne. Préférences : une colonne de réglages, chacun avec son contrôle segmenté et un exemple de ce qu'il change. Téléphone : la liste seule ; une entrée ouvre sa fiche à sa place, avec un retour nommé. Signature : la ligne choisie et sa fiche côte à côte, la recherche qui trouve par alias et le montre. Mouvement : la fiche change sans voile ni glissement.

FORM: « La liste et sa fiche », candidat 6 sur 7 de la liste classée, tirage c41dc9db, relance 1.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
