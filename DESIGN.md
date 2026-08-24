# Design : refonte validée le 2026-08-20

Ce document fixe les règles de l'interface. Il remplace la direction du 2026-08-19
(gris purs, accent bleu, empilement de cartes, navigation horizontale), abandonnée
après usage : elle ne répondait à aucune question et ne se distinguait de rien.

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
- L'état est lu **côté serveur** dans le cookie `sidebar_state`, pour que le premier
  rendu ait déjà la bonne largeur.
- L'actif porte l'accent sur l'icône et l'encre pleine sur le texte ; rien d'autre.
- Une vue non encore construite reste visible, désactivée et marquée `V2` : une
  feuille de route lisible vaut mieux qu'une surprise.

### Revenir en arrière

Les liens qui traversent les pages se taguent `?from=<clé>`. `BackLink` lit ce tag et
affiche un retour nommé dans le header. Il **repasse par l'historique**
(`router.back()`), donc la période et les filtres de la page quittée sont retrouvés
intacts ; il ne retombe sur la route nue que sans historique (lien collé).

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
   Toutes les barres sont cuivre. (L'ancienne rampe `--cat0…6` attribuait la teinte
   au *rang*, ce que sa propre règle interdisait : supprimée.) L'arc d'un donut est
   l'exception qui se justifie : une part de cercle n'a pas d'identité lisible sans sa
   teinte. D'où une teinte par groupe, sur un jeu fermé de cinq plus un reste, jamais
   par catégorie.

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
- **Rien n'est dessiné avant mesure du conteneur.** Une largeur devinée pousse les
  marques hors cadre au lieu de les mettre à l'échelle ; la place est réservée par
  `minHeight` pour éviter le saut.
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

## Composants

**Un besoin d'interface passe d'abord par le système, jamais par un élément
natif.** La base est shadcn/ui (style new-york), installée par son CLI dans
`apps/web/src/components/ui/`. Une date se saisit avec `Calendar` + `Popover`,
un choix exclusif avec `Tabs`, une liste déroulante avec `Select` Radix, une
confirmation destructive avec `AlertDialog`, un panneau avec `Sheet`. Un
`<input type="date">` ou un `<select>` du navigateur casse la palette, ignore
le thème et ne se comporte pas comme le reste : si un composant manque, il
s'ajoute par `shadcn add` avant d'écrire l'écran. La règle vaut aussi quand le
cas paraît trop petit pour mériter le composant (une ligne d'échéancier, un
champ dans un tableau) : c'est précisément là que les écarts s'accumulent.

Ces fichiers nous appartiennent (modèle shadcn) ; les divergences volontaires
avec le registre sont locales et motivées, en commentaire, sur place.

## Densité et conteneurs

- **La carte n'est pas le conteneur par défaut.** Elle sert un objet réellement
  détachable (le bloc de connexion). Le titre d'une page, sa rangée de filtres, ses
  listes et ses tuiles vivent sur le fond de page ; ce sont les **filets** et
  l'**espacement** qui séparent (`Rows`, `StatRow`, `Section`).
- Header de page collant (56px), rangée de filtres collante juste dessous.
- Argent : `font-mono` + `tabular-nums` (classe `.tabular`) dans toute colonne de
  chiffres. Geist pour l'interface, Geist Mono pour les montants et les axes.

## Saisie

- **Un panneau latéral** (`EntrySheet`) déclenché par un bouton `+ …` en haut à
  droite. La liste reste visible derrière ; le panneau **reste ouvert après un
  envoi réussi** et les champs se vident, parce que déclarer se fait par salves.
  Un accusé discret confirme (`successLabel`).
- **Les montants se formatent pendant la frappe** (`AmountInput`) : `2000000`
  devient `2 000 000` avant la fin de la saisie, quand un zéro de trop est encore
  bon marché à voir. Le champ visible porte le texte groupé, un champ caché porte la
  valeur machine ; le serveur ne devine jamais ce qu'un espace voulait dire.
- **Une devise se choisit dans un combobox recherchable** (`CurrencySelect`), jamais
  dans un Select brut : ~180 codes n'ont ni vue d'ensemble ni tri utile (le problème
  du sélecteur de pays, mesuré par Baymard). La recherche matche le code et le nom
  français, accents ignorés (« etats » trouve USD), le code passant devant ; les
  devises courantes ouvrent la liste, le déclencheur reste compact et montre le code,
  EUR par défaut. Posé à côté du montant, dont il qualifie l'unité.
- **Un mois se choisit dans une grille d'année** (`MonthField`), jamais dans un Select :
  une liste de mois fait chercher une valeur que la personne connaît déjà, ce que NN/g
  donne en exemple contre les dropdowns, et une année en déborde le plafond de dix
  options qu'elle accorde à un dropdown de date. Douze boutons montrent l'année entière,
  donc un mois est à un clic et une autre année à deux. Même forme que `DateField`
  (déclencheur + popover), parce que c'est la même chose d'un cran plus grossier ;
  `react-day-picker` s'arrête au jour, d'où la grille composée sur `Popover`.
- **Les actions d'une ligne vivent dans un menu `⋯` à son extrémité**, jamais
  étalées dedans : une ligne est d'abord quelque chose à lire, et ses contrôles ne
  doivent pas concurrencer ses chiffres. Vaut pour les mouvements (corriger,
  supprimer), les engagements (changer le montant, résilier), les comptes (pointer,
  modifier, clore) et les entrées du référentiel (renommer). Ce qui reste dans la ligne n'est pas une action mais un
  attribut : le jugement d'un abonnement se change d'un geste pendant la revue
  « que couper ? ».
- **Corriger est aussi accessible que saisir** : la correction s'ouvre dans le même
  panneau que la déclaration, la suppression derrière une confirmation. Une
  correction ne touche jamais les liens d'origine (échéance, pointage) : le panneau le
  dit quand la ligne en porte un.
- **Une avance dit qui doit et combien.** La part attendue se saisit en euros **ou** en
  pourcentage de la dépense, deux champs qui se répondent : un partage à quatre se pense
  en pourcentage, un article prêté dans un panier commun se pense en euros. Celui qu'on
  tape fait foi, l'autre suit. Et quand l'argent est déjà revenu au moment de déclarer,
  une case écrit le revenu dans la même transaction plutôt que d'exiger une deuxième
  saisie.
- **Une créance est un travail à faire, pas un filtre.** Les avances non remboursées
  s'affichent en tête des mouvements, hors période : celle de quatre mois est exactement
  celle qu'on a oubliée. Chaque ligne dit ce qui est dû et porte le geste qui la referme,
  montant modifiable, parce qu'un remboursement arrive partiel aussi souvent qu'entier.
  « Remboursé » **écrit le revenu** sur le compte qui a payé : cocher un drapeau
  laisserait le solde calculé et le pointage mentir. Renoncer au reste est l'autre geste,
  dans le menu de la ligne, et il ne dit pas la même chose.
- **Ce qui est dû a sa colonne**, à côté du montant, pas la ligne de la note : deux faits
  différents ne partagent pas une place. Elle n'apparaît que si la sélection porte une
  créance vivante, parce qu'une colonne vide sur toutes ses lignes ne dit rien.
- **Le référentiel se corrige dans ses listes.** Réglages montre les catégories, les
  activités et les acteurs en lignes, chacune avec son menu `⋯` ; les acteurs, seuls à
  grossir, portent un champ de recherche. Renommer ne demande rien de plus : ce qui est
  classé sous une entrée la désigne par identifiant, jamais par son nom.
- **Un pointage se corrige comme il se déclare** : « Pointages », dans le menu du compte,
  ouvre l'historique (lu, calculé, écart, soldé ou non), et chaque ligne se corrige ou se
  supprime. Corriger un pointage, c'est le refaire : le panneau le dit, et dit ce que
  devient l'ajustement qui le soldait.
- **Solder un écart est un dernier recours, et il le dit.** L'entrée n'existe que sur un
  pointage dont l'écart n'est pas soldé ; le panneau dit ce qui manque et dans quel sens
  (« 50,00 € de sorties manquent au 21/08 »), puis que déclarer ce qui manque vaut mieux.
  L'acteur d'attribution se saisit comme dans un mouvement, autocomplété.
- **Un doublon d'acteur se répare dans sa ligne** : « Ajouter un alias » pour qu'un nom
  cesse de créer un doublon, « Fusionner dans… » pour absorber celui qui existe déjà. La
  ligne montre les alias qu'elle porte (« aussi Macdo, McDo »), et le panneau de fusion
  annonce qu'il réécrit des mouvements déjà déclarés : c'est le seul geste qui le fait, et
  la contrepartie de créer un acteur dès qu'un nom saisi ne résout pas.
- **Clore n'est pas un cul-de-sac** : un compte clos garde son menu, s'y corrige et s'y
  réouvre. Une clôture par erreur ne doit pas obliger à recréer un compte, donc à
  redéclarer son historique.
- **La périodicité est une seule question** : « chaque mois », « toutes les 2 semaines »,
  « tous les 3 mois », plutôt qu'une unité et un multiple à combiner de tête. La liste
  couvre les rythmes réels ; un engagement déclaré par le MCP avec un multiple hors liste
  garde le sien dedans, pour qu'une correction ne le réécrive pas en passant.
- **Un engagement se corrige comme il se déclare** : « Modifier », dans le menu de la
  ligne, ouvre un panneau qui reprend les champs de la déclaration (nom, acteur, catégorie,
  activité, périodicité, fin d'engagement), préremplis avec ce qu'ils valent. Le montant et
  le compte n'y sont pas : datés et historisés, ils gardent leur geste propre. Et une
  correction ne réécrit pas les mouvements déjà déclarés, qui disent ce qui s'est passé sur
  le compte où ça s'est passé : le panneau le dit plutôt que de laisser le découvrir après.
- **Changer de compte est un geste daté** (« Changer de compte », dans le menu de la
  ligne) : le nouveau compte et le jour où il prend effet, aujourd'hui par défaut, parce
  qu'un prélèvement qui déménage s'apprend souvent avant de bouger. Le déménagement annoncé
  se lit sur la ligne (« passe sur Livret A le 01/09 »), seul endroit où il existe avant sa
  date, et chaque échéance à confirmer dit le compte qu'elle touchera : celui de sa date,
  qui n'est pas toujours celui d'aujourd'hui.
- **Confirmer une échéance n'est pas un oui/non.** Le montant est modifiable sur
  place, parce que la réalité diverge en routine : un salaire bouge avec le nombre
  de jours ouvrés, une prime tombe, un abonnement grimpe. Dès que le montant saisi
  diffère, une seule question apparaît : *est-ce le nouveau montant habituel ?*,
  parce que c'est la seule chose que l'app ne peut pas déduire, et que la réponse
  tranche entre un mois exceptionnel et un changement de prix historisé. Les deux
  écritures partent dans la même transaction.
- **Un plan à échéances se déclare par son total**, et l'échéancier qui en découle
  est **écrit**, pas dérivé : montants égaux à une période d'intervalle, le centime
  d'arrondi sur la dernière ligne. Il s'affiche en résumé (« 3 échéances de
  333,33 €, la dernière de 333,34 € ») plutôt que d'être demandé, parce que c'est
  le chiffre qu'on saisit de travers.
- **Chaque échéance est ajustable, date et montant**, sur demande (« Ajuster chaque
  échéance »). Un vrai plan est rarement régulier : un acompte plus gros, un premier
  mois au prorata, une date repoussée d'un week-end, un arrondi que le vendeur a mis
  sur la deuxième ligne. Quelle ligne diffère n'est pas devinable, donc **toutes**
  sont modifiables dès qu'on le demande, et l'écart avec le total dû s'affiche en
  direct. Le restant dû est la **somme de ce qui reste**, jamais une soustraction
  qu'un arrondi pourrait fausser.
- **Un échéancier écrit se révise après coup** (« Réviser l'échéancier », dans le menu de
  la ligne, dans un panneau parce qu'un plan a autant de lignes qu'il a d'échéances). Le
  panneau montre le plan entier, échéances déjà payées comprises, et c'est le plan entier
  qui repart : son ordre est l'ordre contractuel, et le total dû est la somme de ses lignes,
  donc un report, une renégociation ou un solde anticipé s'écrivent ici plutôt que d'exiger
  un nouveau financement. Une échéance payée porte ce qui est réellement sorti du compte :
  corriger son montant corrige son mouvement, la retirer supprime ce mouvement, et le
  panneau l'annonce avant l'envoi.
- **Sa progression se lit dans un anneau** portant le pourcentage payé. Pas
  « 9/24 » : à 24 échéances le texte ne tient plus dans l'anneau, alors que le
  compte exact a toute la place dans la ligne juste à côté.
- **Une échéance écrite ne se « passe » pas** : elle est due. Elle se confirme, ou
  le financement se clôt. Passer reste réservé aux abonnements (mois offert,
  service en pause).
- Select Radix partout, y compris dans les formulaires à server actions. Calendar +
  Popover pour les dates, locale `fr`. Tabs comme segmented control pour les choix
  exclusifs.
- **La validation est la nôtre, pas celle du navigateur.** Les formulaires sont en
  `noValidate` : `required` sur un Select Radix n'a pas d'input natif à valider, et
  le navigateur ancrait sa bulle sur un champ que l'utilisateur n'éditait même pas.
  Chaque action renvoie ses messages **par champ** ; le formulaire les diffuse par
  contexte et le champ concerné les affiche, en rouge, avec son libellé et son
  contour. Une saisie refusée n'est jamais perdue : les champs texte tiennent leur
  valeur en état, car React réinitialise un champ non contrôlé dès qu'une action se
  termine : ce qui est juste après un succès et faux après une erreur.
- **Un contrôle qui s'envoie tout seul ne vit pas dans un formulaire.** Corollaire du
  point précédent : React réinitialise le formulaire dès que l'action se termine, le
  Select Radix restaure alors la valeur qu'il avait au montage, et l'envoi automatique
  repart pour réécrire l'ancienne valeur par-dessus la nouvelle. Un geste sans bouton
  d'envoi appelle l'action directement, sa valeur en argument, et affiche son échec à
  côté de lui.
- **Un placement se déclare en deux gestes, parce que ce sont deux choses.** Ce qu'on
  détient (un actif, avec la source de son cours) se déclare une fois ; ce qui se passe
  dessus (achat, vente, dividende, frais) se déclare à chaque fois. Le panneau d'opération
  dit ce qu'il ne fait pas, parce que c'est là qu'on se trompe : alimenter le compte ou en
  sortir de l'argent est un virement, à déclarer dans les mouvements.
- **On cherche un actif au moment où on déclare l'opération**, pas dans une course
  préalable : chercher ce qu'on a acheté fait partie du geste d'acheter. Le panneau propose
  d'abord ce qu'on connaît déjà, et le même champ va chercher le reste ; l'actif inconnu est
  créé par l'envoi. Déclarer deux fois le même instrument rend celui qui existe au lieu de
  refuser, sinon une ligne corrigée buterait sur l'actif que sa première tentative a créé.
- **On cherche par ce qu'on en sait, jamais par une clé.** Personne ne connaît un ticker
  Yahoo de tête : le champ prend un nom, un fournisseur, un ticker, un ISIN.
- **Une ligne est un fonds, pas une ligne de cotation.** Le même ETF est coté sur cinq
  places, qui affichent le même prix à 0,01 % près (mesuré : 709,07 / 709,10 / 709,16 €) :
  faire choisir la place à tout le monde ajoutait tout le bruit et aucune précision. « s&p
  500 ucits » passe ainsi de sept lignes à trois fonds.
- **Mais les cotations se voient, et se choisissent, à la demande.** Un chevron sous le
  fonds (« 4 autres cotations du même fonds ») les déplie **sous un filet, indentées** :
  c'est ce qui dit qu'elles sont le même actif et non quatre résultats de plus. Chacune
  porte ce qui varie entre elles et rien d'autre : son ticker, sa place, sa devise, son
  cours. Ce qui ne varie pas (nom, émetteur, capitalisant ou distribuant, ISIN) reste en
  tête, une seule fois. Celle que l'application a retenue est marquée « retenue », et les
  devises qu'elle ne sait pas tenir sont grisées avec une ligne qui le dit une fois.
  Le dépliement **déclenche la recherche** de ces cotations : les lister pour chaque
  résultat coûterait un appel par fonds à chaque frappe, pour ce que presque personne ne
  regarde.
- **Ce qui départage se lit séparément** : l'émetteur, capitalisant ou distribuant, et le
  cours. Noyés dans un nom long tronqué, ces trois faits n'existaient pas. Le cours est le
  plus utile des trois, parce que c'est le seul qui se compare au relevé du courtier : et
  cette comparaison est la seule façon d'être sûr que c'est bien la même ligne. L'écran le
  dit, avec la voie sûre en premier (l'ISIN, affiché par la banque).
- **Ce que l'application ne sait pas encore tenir** (une devise étrangère) reste visible et
  **désactivé, avec sa devise** : disparaître sans un mot se lirait « pas trouvé ».
- **Un portefeuille se lit en courbe, pas en chiffre.** Un nombre dit où on en est, une
  courbe dit si ça va quelque part : la vue trace la valorisation **contre les apports**,
  parce que l'écart entre les deux lignes est la performance, rendue visible au lieu d'être
  affirmée. La fenêtre part de la première opération quand elle est plus récente qu'un an :
  douze mois de plat à zéro ne disent rien et écrasent la partie qui parle.
- **Un placement mène à son détail.** Une ligne de position s'ouvre sur sa propre page :
  son cours en courbe, sa valorisation, ses opérations. Rien n'est un cul-de-sac, et le
  retour est nommé.
- **Une courbe ne descend pas à zéro faute de savoir.** Quand aucun cours n'est connu avant
  un jour donné, le plus ancien connu est reporté en arrière : une chute à zéro dessinerait
  un krach qui n'a pas eu lieu, ce qui est plus faux qu'une approximation dont la fenêtre
  est nommée. Le chiffre du moment garde la règle inverse et reste non valorisé, parce qu'il
  est lu comme exact.
- **Une opération se corrige et se supprime**, depuis le menu de sa ligne : un montant
  d'achat saisi de travers n'est pas cosmétique, il nourrit le PRU et fausserait la position
  aussi longtemps qu'elle est détenue. Le type et l'actif n'y sont pas : les changer ferait
  une autre opération, donc une suppression et une nouvelle déclaration, ce qui est ce qui
  s'est passé. Et une correction qui ferait vendre plus que ce qui était détenu à l'époque
  est refusée en bloc.
- **Suivre n'est pas détenir.** Un actif sans opération est un actif suivi : son cours
  s'affiche dans « Suivis », et le jour où on en achète il devient une position sans rien
  redéclarer. Aucun drapeau n'est nécessaire, l'absence de position suffit.
- **Un cours s'affiche avec son heure.** Le différé de 15 minutes d'Euronext est imposé par
  la licence : la fraîcheur ne se gagne pas, elle se déclare. Un nombre nu serait lu comme
  « maintenant ».
- **Un chiffre affiché dit sa méthode**, et la référence contre laquelle il se mesure en
  fait partie : « dividendes et frais compris, contre 5 000 € d'apports » se vérifie à la
  main, « performance » ne se vérifie pas. Quand une donnée manque pour un calcul, le
  chiffre devient un tiret et dit ce qui manque, au lieu d'un total sous-estimé qui a l'air
  juste.
- **Un chiffre négatif n'est pas une valeur, c'est une déclaration qui manque.** Des
  espèces négatives sur un compte d'investissement veulent dire qu'un achat est entré sans
  le virement qui l'a financé, ce qui est exactement ce qui arrive quand on saisit un
  portefeuille déjà existant. Le total est alors amputé d'autant, donc **il le dit là où il
  s'affiche** (« 4 795 € d'apports non déclarés : pointe les espèces du compte »), sur le
  tableau de bord comme sur Comptes, et il nomme la sortie : le pointage. Sans ça, le total
  a l'air de ne pas compter les placements alors qu'il les compte. Vaut partout où une somme
  calculée peut passer sous zéro sans que la réalité l'ait fait.
- **Un filtre d'URL n'est jamais cru** : un identifiant qui n'a pas la forme voulue,
  ou qui ne désigne rien chez cet utilisateur, est ignoré côté serveur et retombe sur
  « tous » côté contrôle. Une URL bricolée ne casse pas la page.

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

## Raccordement d'une IA

- **Une clé nue n'est pas une connexion** : l'écran livre la commande complète, clé
  incluse, en deux formes (CLI Claude Code, bloc `mcpServers` pour les clients à fichier).
  Le geste attendu est de brancher un agent, pas de ranger un secret.
- **Deux pas numérotés**, comme au premier lancement : créer la clé, coller la commande.
  Avant création, le bloc porte une clé factice et le badge « aperçu » ; la forme se voit
  sans qu'une phrase l'annonce, et rien n'est mémorisé du client choisi puisque la
  commande entière n'existe que le temps où la clé est visible.
- **Le bloc de code s'enroule, il ne défile pas**, et la commande se coupe sur ses propres
  arguments : une commande à moitié copiée coûte plus cher qu'une commande longue.
- **Où la clé marche, et où elle ne marche pas**, se lit en deux lignes ✓ / ✗. Le motif
  (les connecteurs de l'application Claude veulent un OAuth) appartient au dépôt.

## Identité

Marque **abaque** : trois tiges, une perle active par tige, décalées pour qu'on lise
un compte et non un motif. Les tiges héritent de `currentColor`, les perles portent
le cuivre : c'est ce qui la rend reconnaissable à 16px. Deux exemplaires à garder
synchronisés : `components/logo.tsx` (dans l'interface) et `app/icon.svg` (onglet,
sur son propre fond puisqu'un favicon n'hérite d'aucune encre). Wordmark
`abacus` + underscore en cuivre.

## Reste ouvert

- **Densité** : à resserrer ou non une fois l'historique réel saisi.
- **Thème clair** : si un utilisateur le réclame, revalider la famille de séries sur
  la surface claire avant tout.
- **Projection** au sens de la SPEC (échéances à venir, moyennes constatées) : le
  balisage visuel du futur existe déjà, la vue dédiée reste à faire.
