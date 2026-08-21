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
| Patrimoine | Comptes · Placements (V2, désactivé et marqué) |
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

Les liens qui traversent les pages se taguent `?de=<clé>`. `BackLink` lit ce tag et
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
   au *rang*, ce que sa propre règle interdisait : supprimée.)

## Graphes

- **Une seule rangée de filtres**, au-dessus du contenu, qui scope tout ce qui suit.
  Jamais de contrôle de période par graphe. Le sélecteur écrit dans l'URL, donc une
  vue cadrée se partage, se recharge et se défait au bouton retour.
- **Une fenêtre nommée dans le titre** peut différer de la période de la page quand
  la forme l'exige (« 12 derniers mois » pour un graphe mensuel) : c'est déclaré,
  pas subi.
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
- **Interaction** : crosshair aimanté au point le plus proche, tooltip unique listant
  toutes les séries, légende dès deux séries, labels directs en fin de ligne
  (anticollision). Un mois du graphe de flux est un vrai contrôle (rôle, tabulation,
  Entrée/Espace) qui cadre la page dessus.
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
