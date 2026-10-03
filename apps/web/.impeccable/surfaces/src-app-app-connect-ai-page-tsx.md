---
version: 1
slug: "src-app-app-connect-ai-page-tsx"
primary_target: "src/app/(app)/connect-ai/page.tsx"
related_targets: ["src/components/mcp-connection.tsx","src/components/authorization-row-actions.tsx"]
---

Écran : Brancher une IA (`src/app/(app)/connect-ai/page.tsx`). Mode : Operate. Desktop et téléphone.
Question à laquelle il répond : comment brancher une IA sur abacus, et qui y a accès.
Usages : deux, de même poids, comme un réglage : brancher un client (copier l'adresse sous la forme qu'il prend, puis autoriser dans le navigateur) ; voir quelles applications ont accès, en révoquer une.
Contenu et gestes : ceux de l'écran avant refonte (#124), moins les trois exemples de phrases en tête.
Tranché avec l'utilisateur : rien ne domine, les deux parties pèsent pareil ; les exemples sont retirés ; le chemin n'a pas d'intitulé, le titre de page et ses deux pas le nomment déjà.

## Direction contract

THESIS: brancher se lit d'un seul mouvement, de gauche à droite, et ce qui a accès se lit comme un registre. Deux parties de même poids : le chemin nommé par ses pas, la liste par un mot. Refuse le sous-titre qui explique, l'intitulé qui répète le titre, les exemples en pastilles qui ont l'air de boutons, et la pile de sections à hiérarchie plate.

OWN-WORLD: le monde de DESIGN.md, inchangé : fonds bleu nuit, cuivre réservé à l'actif (onglet client choisi, marqueurs des pas), Geist et Geist Mono, filets plutôt que cartes. L'adresse vit dans un bloc de code qui s'enroule, son bouton Copier dedans.

STORY: la personne choisit son client, copie l'adresse sous sa forme, lit juste à côté que l'autorisation se jouera dans le navigateur. Plus tard, elle revient lire quelles applications ont accès, depuis quand, quand elles ont servi, et en révoque une.

FIRST VIEWPORT: en-tête « Brancher une IA », sans sous-titre. Dessous, sans intitulé, la bande des deux pas en pleine largeur : un filet horizontal relie les marqueurs ① et ② ; sous ①, à gauche (≈ 2/3), les onglets client puis l'adresse à copier ; sous ②, à droite (≈ 1/3), autoriser dans le navigateur. Puis « Applications » : table alignée, en-tête de colonnes une fois (application, autorisée le, dernier usage), les dates sous le pas ②, sur le même partage que la bande, le domaine en mono estompé après le nom, ⋯ au bout. Vide : une ligne. Conteneur étroit : les pas s'empilent, le filet devient vertical, chaque application tient sur deux lignes. Signature : les deux pas reliés par leur filet. Mouvement : aucun hors l'accusé « Copié ».

FORM: « Le chemin en bande, le registre en table », candidat 5 sur 6 de la liste classée, tirage 9897795c.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
