# Design — direction validée le 2026-08-19

Référence vivante : la maquette interactive
<https://claude.ai/code/artifact/45bb6d16-31d2-4682-8597-0ec248cdd0ab> (artefact Claude,
données fictives). Ce document fixe les règles ; la maquette les montre.

## Parti pris

Minimaliste, technique, professionnel : l'esthétique « developer » sans l'austérité.
Base **shadcn/ui**, **thème sombre par défaut** (le clair n'est pas prioritaire).
Les graphes sont le cœur de l'application et reçoivent le plus haut niveau de soin :
interactifs, filtrables, jamais décoratifs.

## Typographie

- **Geist** pour l'interface, **Geist Mono** pour les montants, ticks d'axes, libellés
  techniques et le wordmark (`abacus_`).
- `font-variant-numeric: tabular-nums` sur toute colonne de chiffres (tableaux, axes) ;
  chiffres proportionnels pour les grands nombres isolés (tuiles, héro).

## Couleur

Fond quasi noir et blancs cassés (gamme zinc), un accent, une famille de variantes.

| Rôle | Valeur |
|---|---|
| Page | `#0a0a0b` |
| Carte / surface | `#141417` |
| Bordure (hairline) | `#26262b` |
| Encre principale | `#f4f4f5` |
| Encre secondaire | `#a1a1aa` |
| Estompé (axes, labels) | `#7c7c85` |
| Grille | `#222227` |
| Lavis (hover, actif) | `#1c1c20` |
| **Accent** | `#3987e5` |
| Sémantique positif | `#0ca30c` |

### Les deux règles qui gouvernent la couleur

1. **Accent unique pour l'interface.** Le bleu ne marque que l'actif : filtres
   sélectionnés, série mise en avant, fin de sparkline, badge « à résilier », focus.
   Tout le reste est neutre. Jamais d'accent décoratif.
2. **Une famille de variantes pour les séries des graphes**, du bleu vers le violet,
   qui **se distinguent par la luminance, jamais par la teinte seule** (des teintes
   voisines à luminance égale sont indistinguables en vision daltonienne, mesuré :
   ΔE 1 à 2). Famille validée sur la surface `#141417` (CVD ≥ 18, vision normale ≥ 23,
   contraste ≥ 3:1) :

   | Slot | Valeur | Usage |
   |---|---|---|
   | s1 | `#3987e5` | série principale (= l'accent) |
   | s2 | `#c9bcf8` | deuxième série (périwinkle clair) |
   | s3 | `#7365e0` | troisième série (violet) |

   Au-delà de trois séries de courbes : regrouper, ou passer en small multiples. On
   n'ajoute pas une quatrième teinte de courbe sans la re-valider
   (`dataviz` skill, `scripts/validate_palette.js`, surface `#141417`).

3. **Les catégories aussi vivent dans la famille.** Chaque catégorie reçoit une
   variante bleu → violet **stable** (elle suit l'entité, pas son rang dans le
   graphe). Dans un graphe à barres libellées, l'identité est portée par le libellé
   et la valeur ; la couleur n'est qu'une aide de reconnaissance, donc la contrainte
   daltonisme ne s'applique pas à ces variantes (décision du 2026-08-19), seul le
   contraste ≥ 3:1 sur la surface reste exigé. Variantes en service :
   `#3987e5 · #c9bcf8 · #7365e0 · #5a9df0 · #9d92f5 · #3576d4 · #8b7ff0`
   (attribution à la création de la catégorie, réutilisation cyclique acceptée ici
   puisque la couleur n'est pas le canal d'identité).

La couleur suit **l'entité**, jamais son rang : filtrer ne repeint aucune série.
Le sens (positif/négatif) n'est jamais porté par la couleur seule (flèches ↑↓ toujours).

## Graphes

- **Interaction par défaut** : crosshair vertical qui aimante le point le plus proche,
  tooltip unique listant toutes les séries (valeur en gras, nom en secondaire),
  séries activables par la légende, survol des barres avec lift + tooltip.
- **Filtres** : une seule rangée au-dessus du contenu (période d'abord, en presets),
  qui scope tout ce qui est en dessous. Jamais de filtre par graphe.
- **Brut / net partout où les remboursements existent**, les deux lectures toujours
  accessibles ; les virements internes n'apparaissent jamais dans les dépenses.
- **Marques** : lignes 2px, points de fin r4 avec anneau surface 2px, labels directs en
  fin de ligne (anticollision), barres ≤ 24px à bout arrondi 4px sur baseline commune,
  valeurs dans une colonne alignée à droite, grille hairline pleine et discrète, ticks
  arrondis au format français (`13,5k`).
- **Légende dès deux séries** ; une série seule n'en a pas (le titre suffit).
- **Tuiles de stats** : label, valeur, delta signé vs période nommée, sparkline 12
  points (gris estompé, dernier segment et point en accent). Un seul chiffre héro par vue.

## Composants

- Cartes `#141417`, bordure hairline, rayon 12px, ombres quasi nulles.
- Segmented controls pour les choix exclusifs (période, brut/net), chips avec pastille
  de couleur pour les comptes, badges pour les jugements d'abonnements
  (`essentiel` discret, `réductible` contour, `à résilier` plein accent).
- Focus visible (`outline` accent) sur tout ce qui est interactif ;
  `prefers-reduced-motion` respecté.

## Reste ouvert

- **Densité** : aérée (comme la maquette) ou resserrée ; à trancher sur les premiers
  écrans réels avec de vraies données.
- Le thème clair, si un jour un utilisateur le réclame : re-valider la famille de
  variantes sur la surface claire avant tout.
