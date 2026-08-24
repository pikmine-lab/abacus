# Le front d'abacus

Ce fichier porte les règles de construction du front : quel composant pour quel besoin,
les pièges React et Next qui nous ont déjà coûté un bug, et ce que chaque écran doit dire.

Ce qui se voit (palette, densité, forme des marques d'un graphe, ton des textes) est dans
`DESIGN.md`, à la racine. Ce que l'application fait et pourquoi est dans le code du
domaine : `migrations/*.sql` pour ce que le schéma garantit, `packages/core/src/services/`
pour ce que chaque geste fait et refuse. Une règle d'écran ci-dessous dit comment un geste
se présente, jamais ce qu'il autorise : ça, c'est le service qui le tranche, et les deux
interfaces le lisent au même endroit.

## Le système de composants

**Un besoin d'interface passe d'abord par le système, jamais par un élément natif.** La
base est shadcn/ui (style new-york), installée par son CLI dans `src/components/ui/`. Une
date se saisit avec `Calendar` + `Popover` (locale `fr`), un choix exclusif avec `Tabs`,
une liste déroulante avec `Select` Radix, une confirmation destructive avec `AlertDialog`,
un panneau avec `Sheet`. Un `<input type="date">` ou un `<select>` du navigateur casse la
palette, ignore le thème et ne se comporte pas comme le reste : si un composant manque, il
s'ajoute par `shadcn add` avant d'écrire l'écran. La règle vaut aussi quand le cas paraît
trop petit pour mériter le composant (une ligne d'échéancier, un champ dans un tableau) :
c'est précisément là que les écarts s'accumulent.

Ces fichiers nous appartiennent (modèle shadcn) ; les divergences volontaires avec le
registre sont locales et motivées, en commentaire, sur place.

Deux contrôles ne se prennent pas dans le catalogue tel quel :

- **Une devise se choisit dans un combobox recherchable** (`CurrencySelect`), jamais dans
  un Select brut : ~180 codes n'ont ni vue d'ensemble ni tri utile (le problème du
  sélecteur de pays, mesuré par Baymard). La recherche matche le code et le nom français,
  accents ignorés (« etats » trouve USD), le code passant devant ; les devises courantes
  ouvrent la liste, le déclencheur reste compact et montre le code, EUR par défaut. Posé à
  côté du montant, dont il qualifie l'unité.
- **Un mois se choisit dans une grille d'année** (`MonthField`), jamais dans un Select :
  une liste de mois fait chercher une valeur que la personne connaît déjà, ce que NN/g
  donne en exemple contre les dropdowns, et une année en déborde le plafond de dix options
  qu'elle accorde à un dropdown de date. Douze boutons montrent l'année entière, donc un
  mois est à un clic et une autre année à deux. Même forme que `DateField` (déclencheur +
  popover), parce que c'est la même chose d'un cran plus grossier ; `react-day-picker`
  s'arrête au jour, d'où la grille composée sur `Popover`.

## Formulaires, actions et URL

- **La validation est la nôtre, pas celle du navigateur.** Les formulaires sont en
  `noValidate` : `required` sur un Select Radix n'a pas d'input natif à valider, et le
  navigateur ancrait sa bulle sur un champ que l'utilisateur n'éditait même pas. Chaque
  action renvoie ses messages **par champ** ; le formulaire les diffuse par contexte et le
  champ concerné les affiche, en rouge, avec son libellé et son contour. Une saisie refusée
  n'est jamais perdue : les champs texte tiennent leur valeur en état, car React
  réinitialise un champ non contrôlé dès qu'une action se termine, ce qui est juste après
  un succès et faux après une erreur.
- **Un contrôle qui s'envoie tout seul ne vit pas dans un formulaire.** Corollaire du point
  précédent : React réinitialise le formulaire dès que l'action se termine, le Select Radix
  restaure alors la valeur qu'il avait au montage, et l'envoi automatique repart pour
  réécrire l'ancienne valeur par-dessus la nouvelle. Un geste sans bouton d'envoi appelle
  l'action directement, sa valeur en argument, et affiche son échec à côté de lui.
- **Les montants se formatent pendant la frappe** (`AmountInput`) : `2000000` devient
  `2 000 000` avant la fin de la saisie, quand un zéro de trop est encore bon marché à voir.
  Le champ visible porte le texte groupé, un champ caché porte la valeur machine ; le
  serveur ne devine jamais ce qu'un espace voulait dire.
- **Un filtre d'URL n'est jamais cru** : un identifiant qui n'a pas la forme voulue, ou qui
  ne désigne rien chez cet utilisateur, est ignoré côté serveur et retombe sur « tous » côté
  contrôle. Une URL bricolée ne casse pas la page.
- **Un retour repasse par l'historique.** Les liens qui traversent les pages se taguent
  `?from=<clé>` ; `BackLink` lit ce tag et affiche un retour nommé dans le header, par
  `router.back()`, donc la période et les filtres de la page quittée sont retrouvés intacts.
  Il ne retombe sur la route nue que sans historique (lien collé).
- **L'état de la barre latérale est lu côté serveur** dans le cookie `sidebar_state`, pour
  que le premier rendu ait déjà la bonne largeur.
- **Rien n'est dessiné avant mesure du conteneur.** Une largeur devinée pousse les marques
  hors cadre au lieu de les mettre à l'échelle ; la place est réservée par `minHeight` pour
  éviter le saut.
- **Les séries visibles d'un graphe sont un état**, pour que les bascules de la légende
  survivent à un recadrage. Il se resynchronise quand le jeu de lignes change d'identité,
  **pendant le rendu et non dans un effet** : initialisé au seul montage, il désignait après
  un changement de lecture des séries disparues, et le filtre ne laissait plus rien passer.

## Le panneau de saisie

- **Un panneau latéral** (`EntrySheet`) déclenché par un bouton `+ …` en haut à droite. La
  liste reste visible derrière ; le panneau **reste ouvert après un envoi réussi** et les
  champs se vident, parce que déclarer se fait par salves. Un accusé discret confirme
  (`successLabel`).
- **Les actions d'une ligne vivent dans un menu `⋯` à son extrémité**, jamais étalées
  dedans : une ligne est d'abord quelque chose à lire, et ses contrôles ne doivent pas
  concurrencer ses chiffres. Vaut pour les mouvements (corriger, supprimer), les engagements
  (changer le montant, résilier), les comptes (pointer, modifier, clore) et les entrées du
  référentiel (renommer). Ce qui reste dans la ligne n'est pas une action mais un attribut :
  le jugement d'un abonnement se change d'un geste pendant la revue « que couper ? ».
- **Corriger est aussi accessible que saisir** : la correction s'ouvre dans le même panneau
  que la déclaration, la suppression derrière une confirmation. Une correction ne touche
  jamais les liens d'origine (échéance, pointage) : le panneau le dit quand la ligne en
  porte un.

## Ce que chaque écran doit dire

### Mouvements, avances et créances

- **Une avance dit qui doit et combien.** La part attendue se saisit en euros **ou** en
  pourcentage de la dépense, deux champs qui se répondent : un partage à quatre se pense en
  pourcentage, un article prêté dans un panier commun se pense en euros. Celui qu'on tape
  fait foi, l'autre suit. Et quand l'argent est déjà revenu au moment de déclarer, une case
  écrit le revenu dans la même transaction plutôt que d'exiger une deuxième saisie.
- **Une créance est un travail à faire, pas un filtre.** Les avances non remboursées
  s'affichent en tête des mouvements, hors période : celle de quatre mois est exactement
  celle qu'on a oubliée. Chaque ligne dit ce qui est dû et porte le geste qui la referme,
  montant modifiable, parce qu'un remboursement arrive partiel aussi souvent qu'entier.
  « Remboursé » **écrit le revenu** sur le compte qui a payé : cocher un drapeau laisserait
  le solde calculé et le pointage mentir. Renoncer au reste est l'autre geste, dans le menu
  de la ligne, et il ne dit pas la même chose.
- **Ce qui est dû a sa colonne**, à côté du montant, pas la ligne de la note : deux faits
  différents ne partagent pas une place. Elle n'apparaît que si la sélection porte une
  créance vivante, parce qu'une colonne vide sur toutes ses lignes ne dit rien.

### Engagements et échéances

- **La périodicité est une seule question** : « chaque mois », « toutes les 2 semaines »,
  « tous les 3 mois », plutôt qu'une unité et un multiple à combiner de tête. La liste couvre
  les rythmes réels ; un engagement déclaré par le MCP avec un multiple hors liste garde le
  sien dedans, pour qu'une correction ne le réécrive pas en passant.
- **Un engagement se corrige comme il se déclare** : « Modifier », dans le menu de la ligne,
  ouvre un panneau qui reprend les champs de la déclaration, préremplis avec ce qu'ils
  valent. Le montant et le compte n'y sont pas : datés et historisés, ils gardent leur geste
  propre. Et une correction ne réécrit pas les mouvements déjà déclarés, qui disent ce qui
  s'est passé sur le compte où ça s'est passé : le panneau le dit plutôt que de laisser le
  découvrir après.
- **Changer de compte est un geste daté** : le nouveau compte et le jour où il prend effet,
  aujourd'hui par défaut, parce qu'un prélèvement qui déménage s'apprend souvent avant de
  bouger. Le déménagement annoncé se lit sur la ligne (« passe sur Livret A le 01/09 »), seul
  endroit où il existe avant sa date, et chaque échéance à confirmer dit le compte qu'elle
  touchera : celui de sa date, qui n'est pas toujours celui d'aujourd'hui.
- **Confirmer une échéance n'est pas un oui/non.** Le montant est modifiable sur place,
  parce que la réalité diverge en routine : un salaire bouge avec le nombre de jours ouvrés,
  une prime tombe, un abonnement grimpe. Dès que le montant saisi diffère, une seule question
  apparaît : *est-ce le nouveau montant habituel ?*, parce que c'est la seule chose que l'app
  ne peut pas déduire, et que la réponse tranche entre un mois exceptionnel et un changement
  de prix historisé.
- **Un plan à échéances se déclare par son total**, et l'échéancier qui en découle
  s'**affiche en résumé** (« 3 échéances de 333,33 €, la dernière de 333,34 € ») plutôt que
  d'être demandé, parce que c'est le chiffre qu'on saisit de travers.
- **Chaque échéance est ajustable, date et montant**, sur demande (« Ajuster chaque
  échéance »). Un vrai plan est rarement régulier : un acompte plus gros, un premier mois au
  prorata, une date repoussée d'un week-end, un arrondi que le vendeur a mis sur la deuxième
  ligne. Quelle ligne diffère n'est pas devinable, donc **toutes** sont modifiables dès qu'on
  le demande, et l'écart avec le total dû s'affiche en direct.
- **Un échéancier écrit se révise après coup** (« Réviser l'échéancier », dans un panneau
  parce qu'un plan a autant de lignes qu'il a d'échéances). Le panneau montre le plan entier,
  échéances déjà payées comprises, parce que c'est le plan entier qui repart. Une échéance
  payée porte ce qui est réellement sorti du compte : corriger son montant corrige son
  mouvement, la retirer supprime ce mouvement, et le panneau l'annonce avant l'envoi.
- **Sa progression se lit dans un anneau** portant le pourcentage payé. Pas « 9/24 » : à 24
  échéances le texte ne tient plus dans l'anneau, alors que le compte exact a toute la place
  dans la ligne juste à côté.
- **Une échéance écrite ne se « passe » pas** : elle est due. Elle se confirme, ou le
  financement se clôt. Passer reste réservé aux abonnements (mois offert, service en pause).

### Comptes, pointages et référentiel

- **Le référentiel se corrige dans ses listes.** Réglages montre les catégories, les
  activités et les acteurs en lignes, chacune avec son menu `⋯` ; les acteurs, seuls à
  grossir, portent un champ de recherche. Renommer ne demande rien de plus : ce qui est
  classé sous une entrée la désigne par identifiant, jamais par son nom.
- **Un doublon d'acteur se répare dans sa ligne** : « Ajouter un alias » pour qu'un nom cesse
  de créer un doublon, « Fusionner dans… » pour absorber celui qui existe déjà. La ligne
  montre les alias qu'elle porte (« aussi Macdo, McDo »), et le panneau de fusion annonce
  qu'il réécrit des mouvements déjà déclarés : c'est le seul geste qui le fait, et la
  contrepartie de créer un acteur dès qu'un nom saisi ne résout pas.
- **Un pointage se corrige comme il se déclare** : « Pointages », dans le menu du compte,
  ouvre l'historique (lu, calculé, écart, soldé ou non), et chaque ligne se corrige ou se
  supprime. Corriger un pointage, c'est le refaire : le panneau le dit, et dit ce que devient
  l'ajustement qui le soldait.
- **Solder un écart est un dernier recours, et il le dit.** L'entrée n'existe que sur un
  pointage dont l'écart n'est pas soldé ; le panneau dit ce qui manque et dans quel sens
  (« 50,00 € de sorties manquent au 21/08 »), puis que déclarer ce qui manque vaut mieux.
  L'acteur d'attribution se saisit comme dans un mouvement, autocomplété.
- **Clore n'est pas un cul-de-sac** : un compte clos garde son menu, s'y corrige et s'y
  réouvre. Une clôture par erreur ne doit pas obliger à recréer un compte, donc à redéclarer
  son historique.

### Placements

- **Un placement se déclare en deux gestes, parce que ce sont deux choses.** Ce qu'on détient
  (un actif, avec la source de son cours) se déclare une fois ; ce qui se passe dessus
  (achat, vente, dividende, frais) se déclare à chaque fois. Le panneau d'opération dit ce
  qu'il ne fait pas, parce que c'est là qu'on se trompe : alimenter le compte ou en sortir de
  l'argent est un virement, à déclarer dans les mouvements.
- **On cherche un actif au moment où on déclare l'opération**, pas dans une course préalable :
  chercher ce qu'on a acheté fait partie du geste d'acheter. Le panneau propose d'abord ce
  qu'on connaît déjà, et le même champ va chercher le reste ; l'actif inconnu est créé par
  l'envoi.
- **On cherche par ce qu'on en sait, jamais par une clé.** Personne ne connaît un ticker
  Yahoo de tête : le champ prend un nom, un fournisseur, un ticker, un ISIN.
- **Une ligne est un fonds, pas une ligne de cotation.** Le même ETF est coté sur cinq places
  qui affichent le même prix à 0,01 % près : faire choisir la place à tout le monde ajoutait
  tout le bruit et aucune précision. « s&p 500 ucits » passe ainsi de sept lignes à trois
  fonds.
- **Mais les cotations se voient, et se choisissent, à la demande.** Un chevron sous le fonds
  (« 4 autres cotations du même fonds ») les déplie **sous un filet, indentées** : c'est ce
  qui dit qu'elles sont le même actif et non quatre résultats de plus. Chacune porte ce qui
  varie entre elles et rien d'autre : son ticker, sa place, sa devise, son cours. Ce qui ne
  varie pas (nom, émetteur, capitalisant ou distribuant, ISIN) reste en tête, une seule fois.
  Celle que l'application a retenue est marquée « retenue ». Le dépliement **déclenche la
  recherche** de ces cotations : les lister pour chaque résultat coûterait un appel par fonds
  à chaque frappe, pour ce que presque personne ne regarde.
- **Ce qui départage se lit séparément** : l'émetteur, capitalisant ou distribuant, et le
  cours. Noyés dans un nom long tronqué, ces trois faits n'existaient pas. Le cours est le
  plus utile des trois, parce que c'est le seul qui se compare au relevé du courtier, et cette
  comparaison est la seule façon d'être sûr que c'est bien la même ligne. L'écran le dit, avec
  la voie sûre en premier (l'ISIN, affiché par la banque).
- **Ce que l'application ne sait pas tenir reste visible et désactivé, avec son motif** :
  disparaître sans un mot se lirait « pas trouvé ».
- **Les positions se lisent par masse.** Actions, fonds, crypto et ce qu'aucun marché ne cote ne
  se lisent pas ensemble : la répartition est la première question posée à un compte, et la
  reconstituer demandait de reconnaître chaque ligne à son nom. Chaque masse porte donc son total
  et se déplie sur ses lignes, ouverte par défaut : le repli est un geste qu'on demande, pas un
  péage. Un compte qui ne tient qu'une masse n'affiche pas d'en-tête, dont le total répéterait le
  sien, et une masse dont aucune ligne n'a de cours affiche un tiret, jamais zéro. Les actifs
  suivis se regroupent pareil, sans total : rien n'y est détenu.
- **La nature d'un actif hors marché se demande à sa déclaration**, dans une liste déroulante
  comme les autres champs du panneau : elle ne concerne que ce qu'aucune source ne cote, donc
  elle ne pèse pas plus qu'un champ ordinaire. Un actif coté ne la demande pas, sa source la dit.
- **Un placement mène à son détail.** Une ligne de position s'ouvre sur sa propre page : son
  cours en courbe, sa valorisation, ses opérations. Rien n'est un cul-de-sac, et le retour est
  nommé.
- **Suivre n'est pas détenir.** Un actif sans opération est un actif suivi : son cours
  s'affiche dans « Suivis », et le jour où on en achète il devient une position sans rien
  redéclarer. Aucun drapeau n'est nécessaire, l'absence de position suffit.
- **Un cours s'affiche avec son heure.** Le différé de 15 minutes d'Euronext est imposé par la
  licence : la fraîcheur ne se gagne pas, elle se déclare. Un nombre nu serait lu comme
  « maintenant ».
- **Un chiffre affiché dit sa méthode**, et la référence contre laquelle il se mesure en fait
  partie : « dividendes et frais compris, contre 5 000 € d'apports » se vérifie à la main,
  « performance » ne se vérifie pas. Quand une donnée manque pour un calcul, le chiffre devient
  un tiret et dit ce qui manque, au lieu d'un total sous-estimé qui a l'air juste.
- **Un chiffre négatif n'est pas une valeur, c'est une déclaration qui manque.** Des espèces
  négatives sur un compte d'investissement veulent dire qu'un achat est entré sans le virement
  qui l'a financé, ce qui est exactement ce qui arrive quand on saisit un portefeuille déjà
  existant. Le total est alors amputé d'autant, donc **il le dit là où il s'affiche**
  (« 4 795 € d'apports non déclarés : pointe les espèces du compte »), sur le tableau de bord
  comme sur Comptes, et il nomme la sortie : le pointage. Sans ça, le total a l'air de ne pas
  compter les placements alors qu'il les compte. Vaut partout où une somme calculée peut
  passer sous zéro sans que la réalité l'ait fait.
- **Une courbe ne descend pas à zéro faute de savoir.** Quand aucun cours n'est connu avant un
  jour donné, le plus ancien connu est reporté en arrière : une chute à zéro dessinerait un
  krach qui n'a pas eu lieu, ce qui est plus faux qu'une approximation dont la fenêtre est
  nommée. Le chiffre du moment garde la règle inverse et reste non valorisé, parce qu'il est lu
  comme exact.
- **Une opération se corrige et se supprime**, depuis le menu de sa ligne : un montant d'achat
  saisi de travers n'est pas cosmétique, il nourrit le PRU et fausserait la position aussi
  longtemps qu'elle est détenue. Le type et l'actif n'y sont pas : les changer ferait une autre
  opération, donc une suppression et une nouvelle déclaration, ce qui est ce qui s'est passé.

### Brancher une IA

- **Une clé nue n'est pas une connexion** : l'écran livre la commande complète, clé incluse,
  en deux formes (CLI Claude Code, bloc `mcpServers` pour les clients à fichier). Le geste
  attendu est de brancher un agent, pas de ranger un secret.
- **Deux pas numérotés**, comme au premier lancement : créer la clé, coller la commande. Avant
  création, le bloc porte une clé factice et le badge « aperçu » ; la forme se voit sans qu'une
  phrase l'annonce, et rien n'est mémorisé du client choisi puisque la commande entière
  n'existe que le temps où la clé est visible.
- **Le bloc de code s'enroule, il ne défile pas**, et la commande se coupe sur ses propres
  arguments : une commande à moitié copiée coûte plus cher qu'une commande longue.
- **Où la clé marche, et où elle ne marche pas**, se lit en deux lignes ✓ / ✗. Le motif (les
  connecteurs de l'application Claude veulent un OAuth) appartient au dépôt.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
