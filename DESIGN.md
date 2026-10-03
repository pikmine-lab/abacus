# Design

Ce document fixe ce qui se voit : parti pris, composition d'un écran, navigation, couleur,
graphes, tri, conteneurs, écriture, identité. Ce qu'un écran précis compose est dans son
brief (`apps/web/.impeccable/surfaces/`) ; comment le front se construit (composants,
pièges React et Next, ce que chaque écran doit dire) est dans `apps/web/AGENTS.md`.

## Parti pris

Minimaliste, technique, professionnel. **Thème sombre unique**, base **shadcn/ui** (style
new-york). Quatre principes gouvernent le reste :

1. **Une vue répond à une question.** Le nom d'un écran est la question qu'il traite, pas
   l'entité qu'il liste : « Abonnements » mélangeait un salaire et un crédit, il est devenu
   *Dépenses récurrentes* et *Revenus récurrents*.
2. **Une chose domine.** Ce qui répond à la question de l'écran se lit en premier et en
   grand, un chiffre le plus souvent, la liste quand l'écran s'ouvre pour elle ; le reste
   lui est subordonné.
3. **Consulter et déclarer sont deux gestes.** La consultation occupe la page ; la saisie vit
   dans un panneau latéral qu'on ouvre, jamais dans la moitié d'un écran de lecture.
4. **Rien n'est un cul-de-sac.** Tout chiffre agrégé mène à son détail, tout détail sait
   revenir d'où il vient.

## Composition d'un écran

- **Un écran qui se lit sur une période a la période pour titre** (`PeriodHeader`) : flèches
  autour, préréglages et mois compté sur la même ligne. Le nom de l'écran reste le titre du
  document pour les technologies d'assistance ; à l'écran, la navigation le dit déjà. Un
  écran sans période garde son titre (`PageHeader`).
- **Le chiffre qui domine est posé à côté de ce qui l'explique** : le patrimoine à côté du
  graphe des soldes. Un seul par écran (`Figure hero`), aucun sur un écran ouvert pour une
  liste : la liste prend alors le traitement dominant, et ses chiffres passent avant le
  graphe qui les étale dans le temps.
- **Les autres chiffres forment une rangée séparée par des filets** (`FigureRow`) : un mot
  pour les nommer, la valeur, l'écart signé contre une fenêtre nommée (la période du titre
  quand c'est elle). Une note n'apparaît que si elle change ce que le chiffre veut dire : une
  méthode (« placements au dernier cours »), une déclaration qui manque, un brut. Pas de
  sparkline : l'historique se lit dans le graphe de l'écran. Sous une liste dominante, la
  rangée se resserre (`Figure compact`, `FigureRow compact`) et range ses chiffres deux par
  deux sur téléphone, un dernier impair prenant la ligne. Un chiffre qui répète la première
  ligne de la liste en dessous n'est pas un chiffre.
- **Un bloc se nomme d'un mot** (`Block`) : « Soldes », « Dépenses », « À venir ». Un
  qualificatif court s'ajoute seulement quand il change le sens du contenu (« rattachement »).
  Le chemin vers le détail est une flèche au bout du nom.
- **Deux lectures d'une même chose vivent sous un seul nom**, côte à côte : groupes et
  catégories de dépenses.
- **Ce qui attend une action est la seule carte de l'écran** (`ActionCard`) : une liste de
  travail est un objet à part, les lectures vivent sur le fond de page. Ce qui demande
  seulement de l'attention (une alerte d'activité) la rejoint sous son propre libellé, sans
  ouvrir une seconde carte. Un chiffre qui mène à son détail est cliquable en entier.
- **Une liste qu'on remplit par salves garde sa saisie à côté d'elle** : sur un écran
  large, le panneau se range à droite, sans voile, et la page se resserre. Chaque ligne
  envoyée se lit dans la liste restée cliquable, corriger une ligne prend la même place, et
  le bouton qui l'a ouvert passe à l'état enfoncé. Plus étroit, le panneau recouvre.
- **Les filtres de dimension passent derrière « Filtres »**, et ce qui est en vigueur se lit
  et se retire en pastilles. La recherche et le type restent à découvert : ce sont eux qui
  retrouvent une ligne.
- **Quand la place manque, un nom passe avant ce qui le qualifie** : la date ou le jugement
  d'une ligne passent dessous plutôt que de le couper, et un contrôle segmenté prend une
  ligne entière plutôt que de défiler hors de vue. La place se lit sur le conteneur, pas
  sur l'écran : un panneau rangé resserre une table autant qu'une tablette.
- **Un fait que porte chaque ligne se dessine dans une colonne alignée** plutôt que de
  s'écrire ligne après ligne : le pointage d'un compte est un rail des 90 derniers jours,
  à la même échelle sur toutes les lignes, un point par pointage, le dernier plein, un
  repère à 45 jours. Un écart ouvert change la forme du point autant que sa couleur. Les
  mots vivent une seule fois, dans la carte de ce qui est à pointer, et la date exacte dans
  l'infobulle du rail, au survol, au focus ou au toucher. L'échelle se pose une fois, dans
  l'en-tête de la liste, au-dessus de sa colonne, et le tri au-dessus des montants.

Les pièces vivent dans `components/composition.tsx`. Un écran pas encore refondu garde
`StatTile` et `Section` jusqu'à son tour (#114).

## Navigation

Barre **latérale pliable** (`collapsible="icon"`), groupée par question posée : ce qui s'est
passé (Vue d'ensemble, Mouvements, Analyse, Activité), ce à quoi on est engagé (Dépenses
récurrentes, Revenus récurrents), ce qu'on possède (Comptes, Placements). Réglages et le
compte utilisateur ferment la barre. **Les groupes sont séparés par un filet, sans
libellé** : chaque entrée nomme déjà son écran.

- **Le menu du compte porte ce qui n'est pas une question sur l'argent** : brancher une IA,
  réglages, déconnexion.
- **Repliée**, seules les icônes restent, le libellé passe en tooltip ; les icônes ne
  changent pas de taille (le wordmark force `!size-6`).
- **Le pli se commande depuis la barre** (`SidebarEdgeToggle`) ; `Ctrl/⌘+B` reste actif.
  Sous `sm`, la barre est un sheet et l'en-tête porte son déclencheur.
- L'actif porte l'accent sur l'icône et l'encre pleine sur le texte, rien d'autre.
- Une vue pas encore construite reste visible, désactivée et marquée `V2`.
- **Un retour est nommé** et ramène la page quittée avec sa période et ses filtres.

## Couleur

Fonds **bleu nuit désaturés** (jamais de gris pur), accent **cuivre**. Les valeurs sont
mesurées : les séries par les contrôles data-viz (bande de luminance OKLCH, plancher de
chroma, ΔE sous daltonisme, contraste sur la surface), les encres par WCAG sur la page.

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

1. **Accent unique, réservé à l'actif** : sélection, focus, bouton primaire, ce qui attend
   une action, badge « à résilier ». Jamais décoratif.
2. **Le cuivre a deux pas** : `--primary` `#e2a04c` est une encre d'interface (contrainte
   WCAG), `--chart-1` `#c58229` la marque de graphe (bande de luminance L 0,48–0,67).
3. **Six séries**, validées en toutes paires sur `#14171f` : `#c58229` cuivre · `#3987e5`
   bleu acier · `#d55181` magenta · `#08856a` sarcelle · `#7d4cc0` violet · `#855e02`
   bronze. Six est le maximum mesuré ; au-delà, les teintes se répètent et le label
   identifie.
4. **Ces six-là se paient en labels** : leur pire paire tombe à ΔE 6,8 en protanopie, légal
   seulement avec un encodage secondaire. Les labels directs sont la condition de la palette.
5. **Ni vert ni rouge en série** : ces teintes portent le sens (revenu, erreur).
6. **Le sens n'est jamais porté par la couleur seule** : flèche ↑↓ sur tout écart, position
   de part et d'autre de zéro sur les flux, libellé sur tout badge.
7. **Pas de couleur par catégorie** : une barre se nomme par son libellé et se mesure par
   sa longueur, toutes les barres et toutes les parts d'un ruban sont cuivre. Seul l'arc
   d'un donut prend une teinte, par groupe, sur un jeu fermé de cinq plus un reste.
8. **Le thème sombre est le seul** : la palette est mesurée contre `#14171f`.

## Graphes

- **Les contrôles qui cadrent un écran sont en haut et écrivent dans l'URL** : une vue
  cadrée se partage, se recharge et se défait au bouton retour. Dans l'en-tête quand
  l'écran se lit sur une période, sinon dans une rangée sous lui.
- **Un contrôle se pose là où porte sa portée.** Quand seul un graphe a une période
  (Placements, où le reste est instantané), ses durées se posent sur lui ; quand le sens
  (Dépenses | Revenus) et la dimension ne cadrent que le classement, ils se posent sur son
  en-tête, le sens tenant lieu de nom du bloc. Un écran ne porte jamais deux périodes.
- **Une fenêtre peut différer de la période de l'écran quand la forme l'exige** (douze mois
  pour un graphe mensuel) ; ses mois sur l'axe la nomment. Sur un mois seul, le graphe de
  flux montre le bloc de douze mois qui le contient, les blocs comptés à rebours depuis le
  mois courant : un clic dans le graphe déplace le lavis, jamais le graphe.
- **Une fenêtre par défaut ne montre pas du vide** : celle d'un portefeuille part de la
  première opération quand elle a moins d'un an, celle d'un graphe de flux laisse de côté
  les mois d'avant la première déclaration.
- **Deux lectures d'une même série, nommées par l'onglet actif** : un portefeuille se lit
  en valorisation contre les apports, ou en écart entre les deux.
- **Une horizontale de référence se trace en plein et se nomme** ; le pointillé veut dire
  « extrapolé ». L'aire part d'elle.
- **Le zéro n'entre dans l'échelle que si la série se lit contre lui** (solde,
  valorisation, performance ; pas un cours). Le pas de grille est un nombre rond taillé sur
  l'amplitude (1, 2 ou 5 × 10ⁿ).
- **Le mois compté a deux lectures, toujours nommées** : la date réelle ou le mois concerné
  (rattachement). Le même contrôle sur les trois écrans de flux. Basculé, il tient tant
  qu'on circule ; un chargement de page repart de la préférence de Réglages, seul endroit où
  elle s'écrit. Il ne touche que les flux : un bloc de soldes rappelle « date réelle » quand
  l'autre lecture est choisie, et un chiffre ou un graphe de flux porte « rattachement »
  quand c'est elle. Une fenêtre glissante lue ainsi nomme aussi, une fois, au-dessus du
  graphe, les mois entiers qu'elle couvre (« rattachement, juil. 2026 → oct. 2026 ») : le
  titre de période n'est alors pas ce qui a été répondu.
- **Le futur se voit** : au-delà d'aujourd'hui, une courbe passe en pointillés, son aire
  s'arrête, son point de fin se creuse, un drapeau « projection » marque la frontière. Un
  mois en cours est hachuré derrière un drapeau « en cours » ; quand sa colonne est trop
  étroite pour lui, le drapeau passe au-dessus du tracé, accroché au pointillé, jamais sur
  le mois d'avant.
- **Le mois de l'écran est lavé** dans un graphe mensuel, pour que l'œil le trouve.
- **Brut et net ensemble** : la part pleine est le net, la part translucide accolée (2 px
  d'écart) ce qui est revenu en remboursement.
- **Le chiffre est le net, et le classement aussi** ; le brut se lit dans la marque et au
  survol, jamais en second nombre sous le premier.
- **Un rang se creuse par proximité** : sous son en-tête, 4 px ; avant le rang suivant,
  16 px ; un retrait et un filet le confirment. Même origine et même échelle d'un niveau à
  l'autre.
- **Interaction** : crosshair aimanté, tooltip unique listant toutes les séries, labels
  directs en fin de ligne avec anticollision. **Une légende dès deux séries, sauf quand la
  position les nomme** : le graphe des flux dit « entré » et « sorti » de part et d'autre
  de zéro, et son infobulle nomme la part remboursée. Les bascules de séries d'un graphe sont sa légende. Un mois du graphe de flux est
  un vrai contrôle (rôle, tabulation, Entrée/Espace) qui recadre la période de l'écran
  dessus, et elle seule : ce qui cadre l'écran par ailleurs (sens, dimension) reste.
- **Une infobulle suit le curseur**, jamais un `title` de navigateur ; elle se retourne au
  bord, ne passe pas sous la main, et ne répète pas ce que la ligne montre.
- **Le label de fin est mesuré, pas estimé** : la marge est taillée sur sa largeur réelle,
  plafonnée au tiers du cadre ; un nom se raccourcit, un montant jamais.
- **Une sélection par défaut dit quelque chose** : les soldes s'ouvrent sur les comptes les
  mieux garnis, sans plafond.
- **Le donut répond par masses** : une part par groupe ; au-delà de cinq, la queue fusionne
  en un reste estompé. Le survol relie l'arc à sa ligne.
- **Un classement se lit en ruban ou en barres, au choix de la personne** (Réglages, rien
  dans l'URL : c'est une façon de lire, pas un cadrage). Le ruban pose la période en une
  barre découpée en parts, cinq et un reste comme le donut, séparées de 2 px ; il porte
  l'écran, donc il monte à 44 px quand une barre de graphe s'arrête à 24. Les noms se
  posent sous les parts assez larges, dès qu'il y en a deux (un seul répéterait la première
  ligne de la liste), et la liste dessous donne chaque part en %. Une ligne
  pointée dans la liste allume sa part, et une catégorie d'un groupe déplié allume la sienne
  dans la part du groupe, à sa place dans l'ordre de la liste. Les barres donnent une barre
  par ligne (`lead` : lignes plus hautes, libellés plus larges, masses en encre pleine).
- **Marques** : lignes 2 px, points de fin r4 avec anneau du fond, barres ≤ 24 px à bout
  arrondi, grille en filet discret, ticks au format français (`13,5k`).

## Tri

- **Le tri se désigne là où la liste le porte** : dans l'en-tête de colonne d'une liste
  alignée (le libellé devient le bouton, un chevron dit le sens), ou par un contrôle nommé
  (« Trier : Solde ↓ ») au bout de l'en-tête d'une liste de blocs. Désigner un critère
  l'active dans son sens d'ouverture, le redésigner inverse.
- **Le sens d'ouverture appartient au critère** : un nom part de A, un montant et une date
  passée du plus grand et du plus récent, une échéance de la plus proche.
- **Une liste s'ouvre sur l'ordre qui répond à sa question** ; l'alphabet seulement là où
  on cherche une ligne avant de la comparer (comptes, référentiel).
- **Dans une liste groupée, le tri range les lignes, pas les groupes**, classés par ce
  qu'ils totalisent. Deux sortes de lignes qui ne se comparent pas ont chacune son intitulé,
  son total et son tri.
- **Ce qui est inconnu ne devient pas le plus petit** : il reste en fin de liste dans les
  deux sens.
- **Le tri s'écrit dans l'URL**, un paramètre par liste.
- **Le chevron ne marque que le critère en vigueur** ; les autres colonnes révèlent le leur
  au survol.

## Conteneurs et densité

- **La carte n'est pas le conteneur par défaut.** Elle sert un objet réellement
  détachable : ce qui attend une action, le bloc de connexion. Le reste vit sur le fond de
  page, séparé par des **filets** et l'**espacement**.
- **Une carte bancaire se dessine comme l'objet qu'elle est**, au format 1,586. Sa face est
  tirée de son identifiant (fond sombre désaturé, motif de filets), donc stable et distincte
  sans rien stocker. Elle porte nom, compte débité, expiration et mode de débit, jamais de
  numéro. Pas de cuivre, puce en argent. Expirée, elle perd sa couleur et garde sa place.
- En-tête collant ; la rangée de filtres, quand l'écran en a une, colle juste dessous.
- Argent : `font-mono` + `tabular-nums` (`.tabular`) dans toute colonne de chiffres ; Geist
  pour l'interface et les chiffres de composition, Geist Mono pour les montants alignés et
  les axes.
- Un besoin d'interface passe par le système de composants, jamais par un élément natif du
  navigateur (`apps/web/AGENTS.md`).

## Écran vide

Le vide d'une application déclarative est un **chemin**, pas un avis : trois pas ordonnés,
chacun disant ce qu'il débloque, cochés à mesure, l'appel à l'action sur le prochain pas
seulement, et la voie MCP pour qui préfère déclarer en langage naturel.

## Écrire

Le texte est le dernier recours : un écran qui doit s'expliquer est mal découpé.

1. **Ce qui peut être montré n'est pas écrit.** Une structure se lit d'un coup d'œil (pas
   numérotés, pastilles, ✓ / ✗, bloc de code), une phrase demande d'être lue. Un exemple
   vaut mieux qu'une description de ce que l'application sait faire.
2. **Un mot nomme un bloc ou un chiffre** ; un libellé fait deux à cinq mots ; une
   explication tient en une phrase. Au-delà, c'est le découpage qu'il faut revoir.
3. **Le fait le plus utile d'abord, et une seule fois.** Deux formulations du même fait sur
   un écran valent zéro.
4. **Ce qui ne change pas l'action reste dans le dépôt** : le motif technique d'une limite,
   le rappel d'une évidence. La limite elle-même se dit.
5. **La voix** : on tutoie ; guillemets français « » et apostrophe typographique ’ ; pas de
   point d'exclamation, pas d'emphase, pas de formule qui annonce au lieu de dire.

## Identité

Marque **abaque** : trois tiges, une perle active par tige, décalées pour qu'on lise un
compte et non un motif. Les tiges héritent de `currentColor`, les perles portent le cuivre :
c'est ce qui la rend reconnaissable à 16 px. Deux exemplaires à garder synchronisés :
`components/logo.tsx` et `app/icon.svg` (sur son propre fond). Wordmark `abacus` +
underscore en cuivre.
