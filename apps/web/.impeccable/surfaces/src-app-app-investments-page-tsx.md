---
version: 1
slug: "src-app-app-investments-page-tsx"
primary_target: "src/app/(app)/investments/page.tsx"
related_targets: ["src/app/(app)/investments/[assetId]/page.tsx","src/components/position-list.tsx","src/components/mass-strip.tsx","src/components/investment-forms.tsx"]
---

Écran : Placements (`src/app/(app)/investments/page.tsx`) et la page d'un actif (`src/app/(app)/investments/[assetId]/page.tsx`). Mode : Operate. Desktop et téléphone, à poids égal.
Question à laquelle il répond : ce que valent mes placements, sur quoi ça repose, et ce que ça rapporte.
Usages, dans l'ordre : lire la valorisation, sa courbe et où l'argent est placé ; déclarer des opérations par salves ; confirmer un versement programmé tombé ; suivre un actif ; corriger une opération ou un versement depuis son menu.
Contenu et gestes : ceux de l'écran avant refonte, sans ajout ni retrait (#122).
Tranché avec l'utilisateur : la structure « Par masses », choisie parmi trois tirées ; l'écran sert à lire et à déclarer ; le téléphone pèse autant que l'ordinateur. À la relecture : la valorisation domine et la performance passe dans la rangée compacte ; le graphe d’évolution passe sous la bande, en pleine largeur, et s’ouvre sur la performance ; la carte reste à côté du chiffre, sans le dépasser.

## Direction contract

THESIS: la répartition se voit avant la ligne. Les positions se lisent par masse, tous comptes confondus, sous un ruban cuivre qui les pèse ; le compte devient l'attribut d'une ligne, et ses espèces une rangée à part. Refuse les trois tuiles égales, une section et un tableau par compte, le sous-titre qui explique chaque bloc et le tableau qui défile à l'horizontale sur téléphone.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, cuivre réservé à l'actif (ce qui attend, le panneau enfoncé) et aux parts du ruban, vert et rouge pour le seul sens d'un gain, toujours avec sa flèche, Geist et Geist Mono tabulaire, filets plutôt que cartes, une seule carte pour ce qui attend une action.

STORY: la personne lit ce que valent ses placements et leur courbe contre les apports, ce qu'ils ont rapporté et ce qu'elle y verse par mois, confirme un versement tombé depuis la carte ; d'un regard sur le ruban elle sait où repose son argent, puis descend les masses, chaque ligne nommant son compte ; elle déclare une salve d'opérations, le panneau rangé à côté du journal qui la reçoit.

FIRST VIEWPORT: en-tête « Placements », Suivre, Programmer un versement, Déclarer une opération au bout. À gauche la valorisation en grand (76 px desktop), la plus-value latente en écart, sa méthode dessous ; sous elle la rangée compacte Performance (signée, sa méthode), Épargne programmée. À droite la carte « À confirmer » quand un versement attend (« À venir » en panneau) : elle ne dépasse pas la colonne du chiffre et défile sous son titre. Sous la bande, le graphe d’évolution en pleine largeur, ouvert sur la performance, la valorisation à un onglet, durées au bout. Dessous, le bloc « Positions » : le ruban (44 px, une part par masse, nom et part sous les parts assez larges, montant en infobulle), l'en-tête des colonnes et son tri, puis une masse par intertitre, ses totaux dans les colonnes, ses lignes : le nom, et dessous le compte, le PRU, l'heure du cours ; quantité, cours, valorisation, +/− value, menu. Les colonnes de chiffres reprennent le partage de la bande et ne bougent pas d'une masse à l'autre. Plus étroit, quantité × cours passe sous le nom ; valorisation et +/− value gardent leur colonne. Ensuite « Comptes » en rangée compacte (valeur, espèces ou à alimenter), « Suivis », « Versements programmés » repliés, « Opérations ». Signature : le ruban des masses, qu'une masse pointée dans la liste allume. Mouvement : survol du ruban et de la liste, infobulle qui suit le curseur ; le panneau qui se range ; rien d'autre.
Page d'un actif : la même grammaire, la valorisation en grand à côté du graphe de son cours, le prix de revient en rangée compacte, ses opérations sans colonne qui répète son nom.

FORM: « Par masses », candidat 6 sur 7 de la liste classée, tirage 86807cd7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
