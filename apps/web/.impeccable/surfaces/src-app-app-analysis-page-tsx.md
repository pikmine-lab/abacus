---
version: 1
slug: "src-app-app-analysis-page-tsx"
primary_target: "src/app/(app)/analysis/page.tsx"
related_targets: ["src/components/flow-chart.tsx","src/components/breakdown-bars.tsx","src/components/share-strip.tsx","src/components/money-map.tsx"]
---

Écran : Analyse (`src/app/(app)/analysis/page.tsx`). Mode : Operate. Desktop et téléphone.
Question à laquelle il répond : où part l'argent, d'où il vient, sur la période et d'un mois à l'autre.
Usages, dans l'ordre : lire le classement (où est parti l'argent) ; passer d'un mois à l'autre pour comparer ; lire les totaux qui le cadrent.
Contenu et gestes : ceux de l'écran avant refonte (#117), plus deux choses tranchées avec l'utilisateur : sur un mois, la frise montre douze mois, alors que le graphe n'y apparaissait pas ; le classement se dessine en ruban ou en barres, au choix de la personne dans Réglages (et par `manage_preferences` côté MCP).
Carte : le classement a une seconde lecture, la carte, choisie par deux icônes au bout de son en-tête (le dessin du classement de Réglages, et une carte). Elle se lit comme une carte géographique : un canevas où l'on zoome à la molette ou au pincement et se déplace au glisser, et où le détail vient avec le zoom, chaque bloc nommé dès qu'il a la place, chaque mouvement avec son acteur, sa date et son montant sans survol ; les textes gardent leur taille. Pas de liste dessous. Un niveau plus bas est un cran de cuivre plus clair. Survolé, un bloc s'éclaire et prend un anneau cuivre d'interface ; choisi d'un clic, il est cadré, le reste s'assombrit, et une barre dans la carte dit son chemin, mène aux mouvements et le relâche. « Par groupe | Par activité » choisit le premier niveau. Mouvement de la carte : 450 ms pour cadrer un bloc ou tout revoir, 200 ms par cran de zoom, rien quand le système demande moins de mouvement.
Tranché avec l'utilisateur : pas de chiffre héros, le classement domine ; les chiffres passent avant la frise ; sur un mois, la frise couvre douze mois glissants par blocs fixes comptés depuis le mois courant, le mois choisi lavé, pour qu'un clic dans la frise ne la décale jamais ; le ruban est le dessin par défaut ; un flux (sankey) a été essayé et écarté.

## Direction contract

THESIS: la période se lit comme un tout découpé en parts. Les chiffres disent combien, la frise situe le mois parmi les autres et le recadre d'un clic, le ruban montre ce que pèse chaque ligne dans le total, et la liste dessous le dit en % en allumant sa part. Refuse les quatre tuiles égales, le sous-titre qui compte les lignes et explique le clic, et le graphe qui parle avant les chiffres.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, accent cuivre réservé à l'actif, Geist et Geist Mono tabulaire, filets plutôt que cartes, parts et barres toutes cuivre, entré et sorti de part et d'autre de zéro.

STORY: la personne lit la période en titre et les totaux d'un mot, voit dans la frise comment ce mois se place parmi les autres, puis lit le ruban : la moitié de ses dépenses est le logement avant tout nombre. Elle pointe une ligne de la liste et sa part s'allume, déplie un groupe et voit la place du loyer dedans, ouvre les mouvements d'une ligne ; elle clique un autre mois dans la frise et tout se recadre.

FIRST VIEWPORT: en-tête collant, la période en titre entre ses flèches, préréglages et mois compté. Dessous la rangée de chiffres à filets, à taille réduite : Dépensé, Reçu, Épargné, et Rythme quand la période compte plusieurs mois. Puis la frise entré/sorti sur toute la largeur, sans titre ni légende, le mois de l'écran lavé. Puis le classement : son en-tête porte Dépenses | Revenus en guise de nom et la dimension au bout ; le ruban pleine largeur, vingt parts puis un reste, noms et % sous les parts assez larges ; la liste avec part et montant. Signature : la ligne pointée allume sa part, la catégorie pointée sa place dans la part du groupe. Mouvement : 150 ms d'opacité sur les parts, rien d'autre.

FORM: « La frise pilote », candidat 4 sur 6 de la liste classée, tirage 173b37f9, puis réordonnée et dotée du ruban à la demande de l'utilisateur.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
