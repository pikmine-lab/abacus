---
version: 1
slug: "src-app-app-movements-page-tsx"
primary_target: "src/app/(app)/movements/page.tsx"
related_targets: ["src/components/entry-dock.tsx","src/components/movement-filters.tsx","src/components/outstanding-advances.tsx"]
---

Écran : Mouvements (`src/app/(app)/movements/page.tsx`). Mode : Operate. Desktop et téléphone.
Question à laquelle il répond : qu'est-ce qui s'est passé, ligne par ligne, et qu'est-ce qu'on me doit.
Usages, dans l'ordre : retrouver une ligne (la vérifier, la corriger), déclarer une salve puis la relire, suivre les avances. Lire un total filtré n'est pas l'usage principal.
Contenu et gestes : ceux de l'écran avant refonte, sans ajout ni retrait (#116).
Tranché avec l'utilisateur : pas de chiffre héros, la liste domine ; compte, catégorie, acteur, activité et « avances en attente » passent derrière un bouton « Filtres », les filtres actifs restent visibles en pastilles ; recherche et type restent à découvert.

## Direction contract

THESIS: déclarer une salve sans perdre la liste de vue. Le panneau de saisie se range à côté de la table au lieu de la voiler, et chaque mouvement envoyé apparaît dans une liste restée lisible et cliquable. Refuse le panneau modal qui assombrit la page, les rangées de filtres qui mangent le premier écran et le sous-titre qui explique.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, accent cuivre réservé à l'actif, Geist et Geist Mono tabulaire pour les montants, filets plutôt que cartes, une seule carte pour ce qui attend une action.

STORY: la personne voit la période, cherche ou filtre, lit la table ; elle ouvre « Déclarer », enchaîne les saisies et les voit entrer ; elle referme ce qui lui est dû depuis la carte « À récupérer ».

FIRST VIEWPORT: une bande collante : la période en titre entre ses flèches, préréglages et mois compté, « Déclarer » au bout ; dessous recherche, type, « Filtres » et pastilles. Puis la carte « À récupérer », la ligne discrète des totaux, la table. Panneau ouvert (≥ 1280 px) : il prend 28rem à droite sans voile, la page se resserre, compte et catégorie passent sous le nom quand la table n'a plus la place. Signature : la table qui se resserre et reste vivante à côté du panneau. Mouvement : le panneau glisse en 200 ms, la page suit, rien d'autre.

FORM: « Panneau de salve », candidat 7 sur 7 de la liste classée, tirage 8c4a94c8.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
