---
version: 1
slug: "src-app-app-accounts-page-tsx"
primary_target: "src/app/(app)/accounts/page.tsx"
related_targets: ["src/app/(app)/accounts/cards/[cardId]/page.tsx","src/components/check-rail.tsx","src/components/account-fold.tsx","src/components/account-row-actions.tsx"]
---

Écran : Comptes (`src/app/(app)/accounts/page.tsx`) et la page d'une carte (`src/app/(app)/accounts/cards/[cardId]/page.tsx`). Mode : Operate. Desktop et téléphone.
Question à laquelle il répond : où est mon argent, compte par compte, et ces soldes collent-ils au réel.
Usages, dans l'ordre : lire les soldes ; pointer un compte et traiter un écart ; suivre ce que les cartes à débit différé doivent encore. Déclarer un compte ou une carte est rare.
Contenu et gestes : ceux de l'écran avant refonte, sans ajout ni retrait (#121).
Tranché avec l'utilisateur : la lecture des soldes passe en premier ; le patrimoine est le chiffre qui domine (la Vue d'ensemble y mène).

## Direction contract

THESIS: chaque solde montre d'un coup d'œil s'il a été vérifié récemment. Un rail de pointage aligné d'une ligne à l'autre remplace la phrase « pointé il y a… · aucun écart ». Refuse les trois tuiles égales, les sous-titres de section qui expliquent et les mentions répétées d'un même fait.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, accent cuivre réservé à l'actif, Geist et Geist Mono tabulaire pour les soldes, filets plutôt que cartes, une seule carte pour ce qui attend une action, cartes bancaires dessinées comme l'objet qu'elles sont.

STORY: la personne lit son patrimoine, voit ce qui est à pointer et le pointe depuis la carte, puis descend les comptes par nature ; d'un regard sur les rails elle sait quels soldes sont frais ; elle déplie un compte pour ses cartes et suit un relevé jusqu'à la page de la carte.

FIRST VIEWPORT: en-tête « Comptes », « Ajouter un compte » au bout. À gauche le patrimoine en grand (76 px desktop) et sa note ; à droite la carte « À pointer » : un écart, un compte jamais pointé ou trop ancien, chacun avec son geste. Dessous, un bloc par nature (Courants, Épargne, Investissement « espèces », Clos) : nom, rail sur 90 jours, solde, menu ; l'en-tête du bloc porte l'échelle du rail et le tri. Signature : les rails alignés, un point par pointage, le dernier plein, rouge s'il laisse un écart ouvert, à gauche du repère 45 j quand il date. Quand la place manque, le rail passe sous le nom. Mouvement : survol du rail, infobulle qui suit le curseur ; rien d'autre.

FORM: « Le pointage se voit », candidat 6 sur 7 de la liste classée, tirage 8ac34d28.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
