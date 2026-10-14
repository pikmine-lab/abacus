---
version: 1
slug: "src-app-app-recurring-income-page-tsx"
primary_target: "src/app/(app)/recurring-income/page.tsx"
related_targets: ["src/components/income-list.tsx","src/components/commitment-rail.tsx"]
---

Écran : Revenus récurrents (`src/app/(app)/recurring-income/page.tsx`). Mode : Operate. Desktop et téléphone, à poids égal.
Question à laquelle il répond : combien rentre chaque mois sans rien faire, et quand ça tombe sur chaque compte.
Usages, dans l'ordre : lire ce qui rentre par mois ; confirmer les versements tombés, montant corrigé au besoin ; corriger une source depuis son menu.
Contenu et gestes : ceux de l'écran avant refonte, sans ajout ni retrait (#120).
Tranché avec l'utilisateur : l'écran est le miroir de Dépenses récurrentes, allégé de ce qui n'existe que côté dépenses (jugement, financements, cartes, économisable) ; la liste se range par compte crédité, comme les dépenses par compte débité.

## Direction contract

THESIS: quand l'argent arrive se voit, sur le même rail de trente jours que les dépenses, pour que les deux écrans d'engagement se lisent de la même façon. Refuse les trois tuiles égales, la liste plate et le sous-titre qui explique.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, cuivre réservé à l'actif (le versement à confirmer), vert pour le montant d'un revenu, Geist et Geist Mono tabulaire, filets plutôt que cartes, une seule carte pour ce qui attend une action.

STORY: la personne lit son revenu mensuel, confirme depuis la carte ce qui est tombé en corrigeant le montant si une prime ou une hausse est passée, puis descend les comptes : sur les rails elle voit ce qui arrive avant la fin du mois.

FIRST VIEWPORT: en-tête « Revenus récurrents », « Ajouter » au bout. À gauche le revenu mensuel en grand, sa note dessous (par an, nombre de sources) ; à droite la carte « À confirmer ». Dessous, un bloc par compte crédité : son nom, l'échelle du rail au-dessus des rails, le tri au-dessus des montants ; le total du compte suit son nom quand il ne répète ni le chiffre de l'écran ni l'unique ligne. Ligne : nom, et dessous seulement ce qui la distingue (rythme s'il n'est pas mensuel, devise, changement de compte annoncé) ; le rail ; le montant en vert, signé ; le menu. Arrêtés repliés en fin de page. Quand la place manque, le rail passe sous le nom.

FORM: miroir de Dépenses récurrentes (« le mois en rail »), choisi par l'utilisateur à la place d'un tirage ; pas de clé de tirage.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
