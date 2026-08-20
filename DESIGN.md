# Design — refonte validée le 2026-08-20

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
| Page | `#0c0e13` | `--background` | — |
| Surface (carte, popover) | `#14171f` | `--card`, `--popover` | — |
| Lavis (survol, actif) | `#1a1e28` | `--muted`, `--accent`, `--secondary` | — |
| Filet | `#212734` | `--border` | décoratif |
| Contour de champ | `#3d4557` | `--input` | 2:1 sur la page |
| Encre principale | `#e8eaf0` | `--foreground` | 16,1:1 |
| Encre secondaire | `#98a1b3` | `--muted-foreground` | 7,4:1 |
| Estompé | `#79839a` | `--faint` | 5,1:1 |
| **Accent (interface)** | `#e2a04c` | `--primary`, `--ring` | 8,6:1 |
| Encre sur accent | `#17120a` | `--primary-foreground` | 8,3:1 |
| Positif | `#4ec27a` | `--good` | 8,6:1 |
| Négatif / erreur | `#e5686b` | `--destructive` | 6,0:1 |
| Grille de graphe | `#1c212c` | `--grid` | — |

### Les règles qui gouvernent la couleur

1. **Accent unique, réservé à l'actif** : onglet ou entrée sélectionnée, focus,
   bouton primaire, fin de sparkline, badge « à résilier ». Jamais décoratif.
2. **Le cuivre a deux pas, pour deux métiers.** `--primary` `#e2a04c` est une encre
   d'interface (contrainte WCAG texte) ; `--chart-1` `#c58229` est la marque de
   graphe (contrainte : bande de luminance sombre L 0,48–0,67, où le pas clair est
   trop pâle pour qualifier). Même rampe, deux usages, aucune confusion.
3. **Trois séries de graphe, plafond dur.** `#c58229` cuivre · `#3987e5` bleu acier ·
   `#d55181` magenta. Validées **en toutes paires** sur la surface `#14171f`, sans
   avertissement. Un quatrième slot échoue : la meilleure candidate (aqua `#199e70`)
   tombe à ΔE 1,6 contre le magenta en deutéranopie. Au-delà de trois séries :
   regrouper ou passer en small multiples — jamais ajouter une teinte.
4. **Ni vert ni rouge en série.** Ces deux teintes portent le sens (revenu, erreur) :
   les réutiliser comme identité brouillerait la lecture.
5. **Le sens n'est jamais porté par la couleur seule** : flèche ↑↓ sur tout delta,
   position au-dessus/au-dessous de zéro sur les flux, libellé sur tout badge.
6. **Pas de couleur par catégorie.** Une barre de dépenses porte son identité dans
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
  supprimer), les engagements (changer le montant, résilier) et les comptes
  (pointer, clore). Ce qui reste dans la ligne n'est pas une action mais un
  attribut : le jugement d'un abonnement se change d'un geste pendant la revue
  « que couper ? ».
- **Corriger est aussi accessible que saisir** : la correction s'ouvre dans le même
  panneau que la déclaration, la suppression derrière une confirmation. Une
  correction ne touche jamais les liens d'origine (échéance, pointage, avance) — le
  panneau le dit quand la ligne en porte un.
- **Confirmer une échéance n'est pas un oui/non.** Le montant est modifiable sur
  place, parce que la réalité diverge en routine : un salaire bouge avec le nombre
  de jours ouvrés, une prime tombe, un abonnement grimpe. Dès que le montant saisi
  diffère, une seule question apparaît — *est-ce le nouveau montant habituel ?* —
  parce que c'est la seule chose que l'app ne peut pas déduire, et que la réponse
  tranche entre un mois exceptionnel et un changement de prix historisé. Les deux
  écritures partent dans la même transaction.
- **Un plan à échéances se déclare par son total.** Le montant par échéance est la
  division, affichée à mesure plutôt que demandée : c'est le chiffre qu'on saisit de
  travers. Il ne devient modifiable que sur demande, car la division tombe rarement
  juste (1 000 € en 3, c'est 333,33 puis 333,34) et seul le contrat dit où va le
  reste. Le restant dû reste exact quoi qu'il arrive : il se dérive du total, jamais
  d'une somme d'échéances arrondies.
- **Sa progression se lit dans un anneau** portant le pourcentage payé. Pas
  « 9/24 » : à 24 échéances le texte ne tient plus dans l'anneau, alors que le
  compte exact a toute la place dans la ligne juste à côté.
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
  termine — ce qui est juste après un succès et faux après une erreur.
- **Un filtre d'URL n'est jamais cru** : un identifiant qui n'a pas la forme voulue,
  ou qui ne désigne rien chez cet utilisateur, est ignoré côté serveur et retombe sur
  « tous » côté contrôle. Une URL bricolée ne casse pas la page.

## Écran vide

Le vide d'une application déclarative est un **chemin**, pas un avis. La vue
d'ensemble affiche trois pas ordonnés, chacun disant ce qu'il débloque, cochés à
mesure, avec l'appel à l'action sur le prochain pas ouvert seulement — et la voie
MCP mentionnée pour qui préfère déclarer en langage naturel.

## Identité

Marque **abaque** : trois tiges, une perle active par tige, décalées pour qu'on lise
un compte et non un motif. Les tiges héritent de `currentColor`, les perles portent
le cuivre — c'est ce qui la rend reconnaissable à 16px. Deux exemplaires à garder
synchronisés : `components/logo.tsx` (dans l'interface) et `app/icon.svg` (onglet,
sur son propre fond puisqu'un favicon n'hérite d'aucune encre). Wordmark
`abacus` + underscore en cuivre.

## Reste ouvert

- **Densité** : à resserrer ou non une fois l'historique réel saisi.
- **Thème clair** : si un utilisateur le réclame, revalider la famille de séries sur
  la surface claire avant tout.
- **Projection** au sens de la SPEC (échéances à venir, moyennes constatées) : le
  balisage visuel du futur existe déjà, la vue dédiée reste à faire.
