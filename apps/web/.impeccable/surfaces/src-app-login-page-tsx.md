---
version: 1
slug: "src-app-login-page-tsx"
primary_target: "src/app/login/page.tsx"
related_targets: ["src/app/consent/page.tsx","src/components/consent-answer.tsx","src/components/abacus-gate.tsx","src/components/logo.tsx"]
---

Écrans : Connexion (`src/app/login/page.tsx`) et Consentement (`src/app/consent/page.tsx`), hors de la coque de l'application. Mode : Operate. Desktop et téléphone.
Question à laquelle ils répondent : entrer dans abacus ; laisser entrer ou non une IA qui le demande.
Usages : se connecter, à chaque visite ou quand une IA lance une autorisation ; créer son compte, une fois ; décider d'une autorisation, rarement et en connaissance de cause.
Contenu et gestes : ceux d'avant la refonte (#125) : se connecter, créer un compte, autoriser, refuser, demande expirée. Une chose ajoutée, tranchée avec l'utilisateur : ouverte par une autorisation, la connexion nomme l'IA qui attend, avec son domaine.
Tranché avec l'utilisateur : la création de compte passe d'un onglet de même poids à un lien sous le formulaire ; la phrase d'accroche disparaît ; au consentement l'abaque est complet, se vide au survol ou au focus de Refuser et se remplit de nouveau sur Autoriser. Après une première version jugée trop petite, la marque elle-même est refaite : « Le compte » (des perles poussées une, deux, trois), choisi parmi quatre pistes, puis jugé trop enfantin et retravaillé en « Grille » (des points pour les places vides, des blocs cuivre pour ce qui est compté) ; la porte tire sa grille sur toute la largeur de la carte.

## Direction contract

THESIS: l'entrée se compte sur la marque. L'abaque part à vide, chaque pas de la connexion fait traverser la grille aux blocs d'un rang, et les trois rangs comptés finissent comme le logo : on est entré. Refuse la carte à onglets égaux, la phrase d'accroche, le « … » d'attente et la bulle du navigateur.

OWN-WORLD: le monde de DESIGN.md, inchangé : fond bleu nuit, une seule carte (le bloc de connexion), Geist, Geist Mono pour les adresses. Le cuivre ne touche que les perles comptées, le bouton primaire et le focus ; un bloc pas encore compté est un petit contour estompé, garé au bout gauche de la grille. Le seul mouvement des deux écrans est celui des blocs.

STORY: la personne ouvre abacus et voit l'abaque à vide. Elle tape son email, le bloc du premier rang traverse ; son mot de passe, les deux du deuxième ; elle envoie, les trois du dernier partent et se posent si le serveur accepte, reviennent avec le message s'il refuse. Venue d'une IA, la carte nomme « Cursor · cursor.com » qui attend, et le consentement s'ouvre sur l'abaque complet ; survoler Refuser le vide, Autoriser le remplit, et elle décide.

FIRST VIEWPORT: une carte centrée d'environ 384 px. En tête, la grille de l'abaque tirée sur toute la largeur de la carte, ses bouts sur les bords du texte, le mot-symbole abacus_ en dessous. Depuis une IA seulement, une ligne « Connecte-toi pour autoriser Cursor », le domaine en Mono. Puis Email, Mot de passe, Se connecter pleine largeur, et sous le bouton le lien « Créer un compte ». Consentement : même en-tête, abaque complet ; la demande en titre, le domaine dessous, l'accès en une phrase, le retour et son avertissement, Refuser et Autoriser en bas à droite. Téléphone : la même colonne, la carte à pleine largeur. Signature : les blocs qui traversent la grille et se remplissent de cuivre. Mouvement : glissement amorti sans rebond, autour de 450 ms ; sous prefers-reduced-motion, les blocs changent d'état sans voyager.

FORM: « L'abaque comme seuil », candidat 7 sur 7 de la liste classée, tirage 2e03b169.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
