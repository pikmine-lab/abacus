# Design

Ce document fixe ce qui se voit : parti pris, navigation, couleur, forme des graphes,
densité, ton des textes, identité. Comment le front se construit (quel composant pour quel
besoin, pièges React et Next, ce que chaque écran doit dire) est dans `apps/web/AGENTS.md`.

## Parti pris

Minimaliste, technique, professionnel. **Thème sombre unique**, base **shadcn/ui**
(style new-york). Trois principes gouvernent tout le reste :

1. **Une vue répond à une question.** Le nom d'un écran est la question qu'il traite,
   pas l'entité qu'il liste. « Abonnements » mélangeait un salaire et un crédit auto :
   il a été coupé en *Dépenses récurrentes* et *Revenus récurrents*.
2. **Consulter et déclarer sont deux gestes.** La consultation occupe la page ; la
   saisie vit dans un panneau latéral qu'on ouvre. Un formulaire ne squatte jamais
   la moitié d'un écran de lecture.
3. **Rien n'est un cul-de-sac.** Tout chiffre agrégé mène à son détail, et tout
   détail sait revenir d'où il vient.

## Navigation

Barre **latérale pliable** (`sidebar` shadcn, `collapsible="icon"`), groupée par
question posée, jamais à plat :

| Groupe | Entrées |
|---|---|
| Suivi | Vue d'ensemble · Mouvements · Analyse |
| Engagements | Dépenses récurrentes · Revenus récurrents |
| Patrimoine | Comptes · Placements |
| (pied) | Réglages · compte utilisateur |

- **Le menu du compte porte ce qui n'est pas une question sur l'argent** : brancher une
  IA, réglages, déconnexion. Un groupe de la barre répond à « qu'est-ce qui s'est passé »,
  « à quoi suis-je engagé », « qu'est-ce que je possède » ; « comment je donne accès à mon
  agent » n'a rien à y faire.
- **Repliée**, seules les icônes restent ; le libellé passe en tooltip
  (`SidebarMenuButton tooltip=`). Les icônes ne changent pas de taille en pliant :
  le wordmark force `!size-6` contre le `[&>svg]:size-4` du bouton.
- **Le pli se commande depuis la barre**, par une poignée à chevron posée sur sa
  propre séparation (`SidebarEdgeToggle`) : replier la navigation est un acte sur la
  navigation, pas sur la page. Le raccourci `Ctrl/⌘+B` reste actif. Sous `sm`, la
  barre est un sheet et le header porte alors un déclencheur.
- L'actif porte l'accent sur l'icône et l'encre pleine sur le texte ; rien d'autre.
- Une vue non encore construite reste visible, désactivée et marquée `V2` : une
  feuille de route lisible vaut mieux qu'une surprise.
- **Un retour est nommé** : les liens qui traversent les pages disent d'où ils viennent, et
  le retour ramène la page quittée avec sa période et ses filtres intacts, jamais sur une
  route nue qu'il faudrait recadrer.

## Couleur

Fonds **bleu-nuit désaturés** (jamais de gris pur), accent **cuivre**. Toutes les
valeurs ci-dessous sont mesurées, pas choisies à l'œil : les séries de graphes par
les contrôles data-viz (bande de luminance OKLCH, plancher de chroma, ΔE sous
simulation de daltonisme, contraste sur la surface), les encres par WCAG sur le fond
de page.

| Rôle | Valeur | Token | Mesure |
|---|---|---|---|
| Page | `#0c0e13` | `--background` | : |
| Surface (carte, popover) | `#14171f` | `--card`, `--popover` | : |
| Lavis (survol, actif) | `#1a1e28` | `--muted`, `--accent`, `--secondary` | : |
| Filet | `#212734` | `--border` | décoratif |
| Contour de champ | `#3d4557` | `--input` | 2:1 sur la page |
| Encre principale | `#e8eaf0` | `--foreground` | 16,1:1 |
| Encre secondaire | `#98a1b3` | `--muted-foreground` | 7,4:1 |
| Estompé | `#79839a` | `--faint` | 5,1:1 |
| **Accent (interface)** | `#e2a04c` | `--primary`, `--ring` | 8,6:1 |
| Encre sur accent | `#17120a` | `--primary-foreground` | 8,3:1 |
| Positif | `#4ec27a` | `--good` | 8,6:1 |
| Négatif / erreur | `#e5686b` | `--destructive` | 6,0:1 |
| Grille de graphe | `#1c212c` | `--grid` | : |

### Les règles qui gouvernent la couleur

1. **Accent unique, réservé à l'actif** : onglet ou entrée sélectionnée, focus,
   bouton primaire, fin de sparkline, badge « à résilier ». Jamais décoratif.
2. **Le cuivre a deux pas, pour deux métiers.** `--primary` `#e2a04c` est une encre
   d'interface (contrainte WCAG texte) ; `--chart-1` `#c58229` est la marque de
   graphe (contrainte : bande de luminance sombre L 0,48–0,67, où le pas clair est
   trop pâle pour qualifier). Même rampe, deux usages, aucune confusion.
3. **Six séries de graphe.** `#c58229` cuivre · `#3987e5` bleu acier · `#d55181`
   magenta · `#08856a` sarcelle · `#7d4cc0` violet · `#855e02` bronze. Validées
   **en toutes paires** sur la surface `#14171f` : c'est la liste stricte, et la bonne
   dès qu'une légende laisse afficher n'importe quel sous-ensemble. Six est le maximum
   mesuré à côté des trois premières, par recherche exhaustive du gamut dans la bande
   de luminance : aucune septième candidate ne passe, et les teintes de départ n'ont
   pas bougé.
4. **Ces six-là se paient en labels.** Leur pire paire tombe à ΔE 6,8 en protanopie,
   dans la bande 6-8 qui n'est légale qu'avec un encodage secondaire. Les labels
   directs en fin de ligne sont donc la condition de la palette, pas un confort. Le
   quatrième slot coûte déjà ce prix et les deux suivants ne coûtent rien de plus : il
   se paie une fois, en passant de trois à quatre. Au-delà de six séries les teintes se
   répètent plutôt que de refuser une série, puisque c'est le label qui identifie.
5. **Ni vert ni rouge en série.** Ces deux teintes portent le sens (revenu, erreur) :
   les réutiliser comme identité brouillerait la lecture. La sarcelle du slot 4 est
   mesurée à distance du vert positif, elle ne l'approche pas.
6. **Le sens n'est jamais porté par la couleur seule** : flèche ↑↓ sur tout delta,
   position au-dessus/au-dessous de zéro sur les flux, libellé sur tout badge.
7. **Pas de couleur par catégorie.** Une barre de dépenses porte son identité dans
   son libellé et sa magnitude dans sa longueur ; la couleur n'encoderait rien.
   Toutes les barres sont cuivre. L'arc d'un donut est l'exception qui se justifie :
   une part de cercle n'a pas d'identité lisible sans sa teinte. D'où une teinte par
   groupe, sur un jeu fermé de cinq plus un reste, jamais par catégorie.
8. **Le thème sombre est le seul.** Un thème clair supposerait de revalider la famille
   de séries sur la surface claire avant tout le reste : la palette est mesurée contre
   `#14171f`, et rien ne garantit qu'elle tienne ailleurs.

## Graphes

- **Une seule rangée de filtres**, au-dessus du contenu, qui scope tout ce qui suit.
  Le sélecteur écrit dans l'URL, donc une vue cadrée se partage, se recharge et se
  défait au bouton retour.
- **Un contrôle de période se pose là où porte sa portée.** La rangée est la forme
  d'un écran dont tout se lit sur une période. Quand seul un graphe en a une, ses
  durées se posent sur sa section (Placements : les tuiles, les positions et les
  opérations sont des instantanés), parce qu'une rangée y promettrait de cadrer ce
  qu'elle ne cadre pas. Ce qui se déplace est le contrôle, pas le reste : il écrit
  dans l'URL comme la rangée, et un écran ne porte jamais deux périodes.
- **Une fenêtre nommée dans le titre** peut différer de la période de la page quand
  la forme l'exige (« 12 derniers mois » pour un graphe mensuel) : c'est déclaré,
  pas subi.
- **Une fenêtre par défaut ne montre pas du vide.** Celle d'un portefeuille part de la
  première opération quand elle est plus récente qu'un an : douze mois de plat à zéro ne
  disent rien et écrasent la partie qui parle.
- **Deux lectures d'une même série, nommées par l'onglet actif.** Un portefeuille se
  lit en valorisation contre les apports (« combien j'ai mis, combien ça vaut ») ou en
  écart entre les deux, apports posés à plat (« combien ça a fait ») : deux questions,
  pas une version dégradée de l'autre. La seconde existe parce que la première écrase
  l'écart, du même ordre de grandeur que les courbes, et parce qu'elle seule ne saute
  pas quand un apport rentre. Le titre de section ne redit pas l'onglet sélectionné ;
  la description dit la méthode (« valorisation − apports »).
- **Une horizontale de référence se trace et se nomme**, en trait plein plus marqué
  que la grille : le pointillé veut dire « extrapolé » partout ailleurs. L'aire part
  d'elle, pas du plancher, pour que le lavis soit ce qui a été gagné ou perdu.
- **Le zéro n'entre dans l'échelle que quand la série se lit contre lui** : un solde,
  une valorisation, une performance. Un cours ne se lit pas contre zéro, et l'y forcer
  aplatit en ligne droite la variation qu'on est venu voir. Le pas de la grille est un
  nombre rond taillé sur l'amplitude (1, 2 ou 5 fois une puissance de dix), jamais une
  constante : un pas de 500 € écrit pour des soldes ne donnait qu'un trait à une action
  à 709 € comme à une performance de 312 €.
- **Deux lectures d'un même mois, toujours nommées.** À côté de la période, la rangée
  porte le mois compté : la date réelle, ou le mois concerné (le rattachement). Le même
  contrôle sur les trois écrans de flux, parce que deux écrans en désaccord sur août
  sans que rien ne le dise est pire que de n'avoir qu'une lecture. Il ne touche que les
  flux : un solde n'a qu'une lecture, et sa section le rappelle quand l'autre est
  choisie. Chaque chiffre porte alors le nom de la lecture qui l'a produit, et une
  fenêtre glissante lue au rattachement se renomme par les mois entiers qu'elle couvre :
  c'est ce qu'elle a répondu.
- **Le futur se voit.** Au-delà d'aujourd'hui, une courbe ne fait que prolonger le
  dernier solde connu : elle passe en **pointillés**, son aire s'arrête, son point de
  fin devient creux, et un **drapeau d'un mot** (« projection ») marque la frontière
  sur une verticale pointillée. Un mois encore en cours est **hachuré** derrière un
  drapeau « en cours » : inachevé n'est pas petit.
- **Brut et net ensemble** : la part pleine est le net, la part translucide accolée
  (2px de respiration) est ce qui est revenu en remboursement. Pleine + translucide
  = brut.
- **Le chiffre est le net, et le classement aussi.** Ce qu'une période a coûté, c'est
  le net : c'est donc lui qu'un rang affiche et lui qui ordonne les lignes, sinon une
  ligne se place au-dessus d'une autre qu'elle finit par passer dessous quand le
  remboursement rentre. Le brut garde sa lecture dans la marque (la queue translucide)
  et au survol ; il n'a pas de chiffre à lui dans la ligne, un second nombre sous le
  premier rendant une ligne remboursée plus haute que ses voisines, ce qui casse le
  rythme vertical dans lequel un classement se lit. Un total de section et la tuile
  qui le résume répondent alors le même nombre.
- **Un rang se creuse par proximité, pas par une boîte.** Quand une ligne se déplie
  (un groupe vers ses catégories), ce qui dit l'appartenance est la distance : le
  contenu se serre sous son en-tête (4px) et le rang suivant est repoussé (16px), soit
  un rapport de un à quatre. L'indentation du libellé et un filet vertical gris bleuté
  le confirment ; un fond plein est la manière lourde de dire la même chose. Les
  marques restent à la même origine et à la même échelle d'un niveau à l'autre, une
  longueur valant un montant partout dans la section, et le niveau déplié se dessine
  plus fin que son en-tête.
- **Interaction** : crosshair aimanté au point le plus proche, tooltip unique listant
  toutes les séries, légende dès deux séries, labels directs en fin de ligne
  (anticollision). Un mois du graphe de flux est un vrai contrôle (rôle, tabulation,
  Entrée/Espace) qui cadre la page dessus.
- **Une infobulle suit le curseur** et n'est jamais un `title` de navigateur. Sur une
  marque qui traverse l'écran (la barre d'un rang), l'ancrer à sa ligne mettrait la
  réponse loin de l'œil : elle se pose à côté du pointeur, se retourne au bord de la
  fenêtre, ne passe pas sous la main (rien au doigt, le tap étant une navigation) et
  porte l'encre des autres infobulles (fond `popover`, filet, montants alignés). Elle
  ne répète pas ce que la ligne montre déjà : elle dit le nombre de mouvements, ce que
  la ligne agrège, et le brut quand un remboursement l'a séparé du net.
- **Le label de fin est mesuré, pas estimé.** La marge droite est taillée sur la largeur
  réelle des labels, dans leur police, et plafonnée au tiers du cadre : un nom qui n'y
  tient pas est raccourci par nous, jamais par le cadre. Le montant ne se coupe pas, lui,
  parce qu'un nombre tronqué est un nombre faux. L'anticollision écarte vers le bas puis
  recale la pile sur les deux bords, sinon la sixième série sort du cadre par le bas ; et
  au-delà de ce que la hauteur tient, les labels cèdent la place à la légende.
- **Une sélection par défaut dit quelque chose.** Le graphe de soldes s'ouvre sur les
  comptes les mieux garnis, autant que la palette en tient, jamais sur les premiers par
  ordre alphabétique. Il n'oppose pas non plus de plafond : comparer plus de comptes est
  exactement ce que la vue d'ensemble promet.
- **Le donut répond par masses, pas par lignes.** Une part par groupe, une ligne de
  légende par part, l'identité et le montant dans la légende. Au-delà de cinq groupes
  la queue fusionne en une seule part, nommée par ce qu'elle contient et tracée dans
  l'encre estompée : c'est un reste, pas une identité, et il referme le cercle sans
  buter sur la première teinte. Le survol relie l'arc à sa ligne (les autres
  s'effacent) et le creux dit ce que la légende ne répète pas : le net et le nombre de
  mouvements.
- **Marques** : lignes 2px, points de fin r4 avec anneau de la couleur du fond,
  barres ≤ 24px à bout arrondi, grille en filet discret, ticks au format français
  (`13,5k`).
- **Tuiles de stats** : label, valeur, delta signé contre une fenêtre **nommée**,
  sparkline 12 points (gris estompé, dernier segment et point en accent). **Un seul
  chiffre héro par vue.** Une tuile qui mène quelque part porte une flèche
  ↗ dans son coin haut droit, à taille d'icône.

## Densité et conteneurs

- **La carte n'est pas le conteneur par défaut.** Elle sert un objet réellement
  détachable (le bloc de connexion). Le titre d'une page, sa rangée de filtres, ses
  listes et ses tuiles vivent sur le fond de page ; ce sont les **filets** et
  l'**espacement** qui séparent (`Rows`, `StatRow`, `Section`).
- Header de page collant (56px), rangée de filtres collante juste dessous.
- Argent : `font-mono` + `tabular-nums` (classe `.tabular`) dans toute colonne de
  chiffres. Geist pour l'interface, Geist Mono pour les montants et les axes.
- Un besoin d'interface passe d'abord par le système de composants, jamais par un
  élément natif du navigateur, qui casserait la palette et ignorerait le thème. Le
  catalogue et la façon d'y ajouter une pièce sont dans `apps/web/AGENTS.md`.

## Écran vide

Le vide d'une application déclarative est un **chemin**, pas un avis. La vue
d'ensemble affiche trois pas ordonnés, chacun disant ce qu'il débloque, cochés à
mesure, avec l'appel à l'action sur le prochain pas ouvert seulement : et la voie
MCP mentionnée pour qui préfère déclarer en langage naturel.

## Ce qu'on écrit à l'écran

Le texte est le dernier recours, pas le premier réflexe : un écran qui doit s'expliquer
est un écran mal découpé.

1. **Ce qui peut être montré n'est pas écrit.** Une structure se lit d'un coup d'œil
   (pas numérotés, exemples en pastilles, ✓ / ✗, bloc de code), une phrase demande d'être
   lue en entier. Un exemple entre guillemets vaut mieux qu'une description de ce que
   l'app sait faire.
2. **Le fait le plus utile d'abord, et une seule fois.** Ce qui décide de l'action ouvre
   le bloc ; ce qui l'explique n'y revient pas. Deux formulations du même fait sur un
   écran valent zéro.
3. **Ce qui ne change pas l'action de l'utilisateur reste dans le dépôt** : le motif
   technique d'une limite, le détail d'un drapeau, le rappel d'une évidence. La limite
   elle-même se dit, parce qu'elle change ce que l'utilisateur va faire.

Un libellé fait deux à cinq mots, une explication tient en une phrase. Au-delà, c'est le
découpage de l'écran qu'il faut revoir, pas la phrase qu'il faut raccourcir.

## Identité

Marque **abaque** : trois tiges, une perle active par tige, décalées pour qu'on lise
un compte et non un motif. Les tiges héritent de `currentColor`, les perles portent
le cuivre : c'est ce qui la rend reconnaissable à 16px. Deux exemplaires à garder
synchronisés : `components/logo.tsx` (dans l'interface) et `app/icon.svg` (onglet,
sur son propre fond puisqu'un favicon n'hérite d'aucune encre). Wordmark
`abacus` + underscore en cuivre.
