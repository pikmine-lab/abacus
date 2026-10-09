---
version: 1
slug: "src-app-app-recurring-expenses-page-tsx"
primary_target: "src/app/(app)/recurring-expenses/page.tsx"
related_targets: ["src/components/expense-rail.tsx"]
---

Écran : Dépenses récurrentes (`src/app/(app)/recurring-expenses/page.tsx`). Mode : Operate. Desktop et téléphone, à poids égal.
Question à laquelle il répond : combien je paie chaque mois sans y penser, en abonnements et en financements, et quand ça part de chaque compte.
Usages, dans l'ordre : lire ce que ça coûte par mois, au total et en deux parts ; confirmer les échéances tombées ; juger un abonnement ; corriger une ligne depuis son menu.
Contenu et gestes : ceux de l'écran avant refonte, sans ajout ni retrait (#119).
Tranché avec l'utilisateur : le coût mensuel domine, en total et en deux parts (abonnements, financements) ; le rangement de la liste est ouvert ; le téléphone pèse autant que l'ordinateur. À la relecture : la carte ne dépasse pas la colonne du chiffre et défile dessous son titre ; « À venir » ouvre un panneau ; chaque sorte se replie, pas le compte ; le compte, la sorte et la ligne se distinguent par leur graisse, et le filet sous le compte est celui des lignes, pas le trait d'un rail.

## Direction contract

THESIS: quand l'argent part se voit. Chaque ligne place sa prochaine échéance sur un rail des trente prochains jours, aligné d'une ligne à l'autre comme le rail de pointage de Comptes. Refuse les quatre tuiles égales, le jugement écrit deux fois, « par mois » répété sur chaque ligne et les trois niveaux de repli (compte, moyen de paiement, sorte).

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, cuivre réservé à l'actif (l'échéance à confirmer, « à résilier »), Geist et Geist Mono tabulaire, filets plutôt que cartes, une seule carte pour ce qui attend une action.

STORY: la personne lit son coût mensuel et ses deux parts, confirme ce qui est tombé depuis la carte, puis descend les comptes : sur les rails elle voit ce qui part avant la fin du mois et ce qui attend ; elle juge un abonnement en bout de ligne.

FIRST VIEWPORT: en-tête « Dépenses récurrentes », « Ajouter » au bout. À gauche le coût mensuel en grand (76 px desktop), sous lui la rangée compacte Abonnements, Financements (avec le restant dû), Économisable ; à droite la carte « À confirmer ». Dessous, un bloc par compte débité, son total par mois en tête ; dans chaque bloc, les abonnements puis les financements, chacun sous son intitulé avec son total et son tri. Ligne : nom, et dessous seulement ce qui la distingue (carte, rythme s'il n'est pas mensuel, changement de compte annoncé, avancement d'un financement avec son anneau) ; le rail ; le montant ; le jugement ; le menu. L'échelle du rail se pose une fois en tête de liste : aujourd'hui, le passage du mois, la date à trente jours. Signature : le rail, un point par échéance à venir, une échéance en attente en cuivre à gauche d'aujourd'hui, ce qui tombe au-delà de trente jours épinglé au bord droit, creux ; la date exacte en infobulle. Quand la place manque, le rail passe sous le nom. Terminés repliés en fin de page. Mouvement : survol du rail, infobulle qui suit le curseur ; rien d'autre.

FORM: « Le mois en rail », candidat 3 sur 7 de la liste classée, tirage 741eff48.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
