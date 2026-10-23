# Constitution d'abacus

Les principes qu'un agent respecte quand il spécifie, planifie, écrit ou juge du code dans
ce dépôt. Chacun dit comment on vérifie qu'il est tenu. Une spec ou un plan qui exige d'en
sortir est faux et se corrige ; un principe qui ne tient plus se change ici.

## I. Tout déclaratif

Aucune donnée personnelle n'arrive d'une connexion bancaire ni d'un service tiers : une
personne la saisit par le web, ou une IA par le MCP. Seule exception, les données publiques
de marché : cours de bourse et de crypto, taux de change.

*Vérifié par* : la garde de dépendances (seul le module de marché fait des appels sortants) ;
la revue de code.

## II. Le cas d'usage d'un utilisateur n'entre jamais dans le code

Ses établissements, ses clients, ses comptes et ses montants sont des données. Un fait public
(le régime fiscal et social d'une juridiction, un instrument coté) se livre avec le dépôt,
en données datées et sourcées ; le code applique un modèle sans savoir de quel pays ou de
quel établissement il parle. Ce qu'un utilisateur tire d'un modèle public (le régime copié
dans son activité) est une copie qui lui appartient et qu'il corrige. Faux par principe : un
nom d'établissement en dur, une condition sur un pays, un taux écrit dans une fonction.

*Vérifié par* : la revue de code ; l'analyse Spec Kit sur la spec et le plan.

## III. Un net ne déduit que l'argent qui a bougé

Une dépense se lit nette des remboursements reçus, jamais de ceux qui sont attendus ; un
revenu d'activité se lit net des cotisations et impôts payés, jamais de ceux qui sont dus.
Ce qui est attendu ou dû se dit à côté du chiffre, nommé, sans le changer. « Net » veut dire
la même chose sur chaque écran et dans le MCP, parce qu'un seul calcul le produit.

*Vérifié par* : les tests de cas d'usage (un remboursement attendu ne change pas le net,
le même reçu le change), joués sur les deux interfaces.

## IV. Le pointage est le garde-fou du modèle

Une comptabilité déclarative dérive si rien ne la rapproche du réel. Le pointage d'un solde
est un geste de première classe : ce qui l'affaiblit (un solde calculé de deux façons, un
mouvement qui échappe au solde) affaiblit tout le reste. Le solde d'un compte n'a qu'une
définition, exposée par le module du grand livre ; tout autre module qui en a besoin
l'appelle.

*Vérifié par* : les tests du grand livre ; la revue de code, qui refuse un second calcul du
solde.

## V. L'argent et les devises

Un montant est une valeur décimale et sa devise, jamais un nombre à virgule flottante. Tout
fonctionne avec n'importe quelle devise : additionner deux devises est refusé, une
conversion est toujours explicite, avec son taux et sa date. La devise pivot est l'euro et
n'est pas modifiable aujourd'hui, mais aucun mécanisme ne suppose l'euro : il se lit d'un
seul endroit. Montants, décimales, arrondi, répartition en parts, pourcentages, dates et
périodes ne se manipulent que par le module central de briques, qui les définit une seule
fois : deux calculs ne peuvent pas diverger.

*Vérifié par* : le compilateur (un montant est un type opaque, qu'aucun opérateur
arithmétique n'accepte) ; la garde de dépendances ; les tests du module de briques.

## VI. Aucune route sans règle d'accès

Chaque route déclare sa règle d'accès, choisie dans un ensemble fermé et générique : publique
(l'authentification elle-même), propriétaire (l'utilisateur connecté, sur ses seules
données), et demain d'autres niveaux (administration, back-office) qui s'ajoutent à cet
ensemble, jamais au cas par cas. Une route sans règle ne peut pas exister : l'accès est
refusé par défaut. Toute entité du domaine appartient à un utilisateur et n'est visible et
modifiable que par lui, sauf les données publiques, qui n'appartiennent à personne et sont
partagées : instruments cotés et leurs cours, modèles de régimes du catalogue. Ce que
chacun en détient ou en tire reste à lui.

*Vérifié par* : le compilateur (on ne peut pas enregistrer une route sans lui donner sa
règle) ; un test qui parcourt toutes les routes et éprouve leur règle (anonyme refusé sur
une route protégée, second utilisateur refusé sur les données du premier) ; un test qui
compare les routes du contrat à celles qui portent une règle.

## VII. L'architecture

1. **Les interfaces ne parlent qu'à l'API**, par le client généré depuis son contrat. Ni
   appel réseau à côté, ni import du back. Le client généré ne s'édite jamais à la main.
2. **Chaque route est un geste atomique** qui laisse les données cohérentes à elle seule.
   Deux écritures qui n'ont de sens qu'ensemble forment une seule route. La route ouvre la
   transaction et la prête aux modules ; un module ne valide ni n'annule jamais une
   transaction lui-même.
3. **L'API ne touche jamais la base**, elle passe par les modules. Un module possède ses
   tables, dans son propre schéma, et ne lit jamais celles d'un autre : il passe par
   l'interface de ce module, qui n'expose que le nécessaire. Les dépendances entre modules
   vont dans un seul sens, le grand livre ne dépend d'aucun autre module, et le graphe des
   dépendances autorisées est écrit à un seul endroit : y ajouter une flèche est validé par
   un humain. Le socle technique et le noyau de briques, dont tout module peut dépendre, ne
   contiennent aucun métier.
4. **La base ne porte que la structure** : types, NOT NULL, clés étrangères, unicité. Ni
   colonne générée, ni CHECK métier, ni fonction, ni trigger, ni vue : la logique vit dans
   le code, où elle est testée. Une migration ne se modifie plus une fois sur `main`.
5. **Un calcul métier vit dans le module qui le possède**, sans entrée-sortie. Un calcul
   métier produit un chiffre qui a un sens pour l'utilisateur (montant, total, net, taux,
   solde, échéance) ; il ne se fait ni en base, ni côté client, ni dans une interface. Une
   interface ne fait que de la présentation : trier, filtrer, mettre en page, mettre à
   l'échelle un graphe.
6. **Les règles d'entrée viennent du contrat** : ce qu'un schéma sait dire y est déclaré,
   ce qui dépend de l'état revient en code d'erreur nommé. Une interface n'invente aucune
   règle de validation.

*Vérifié par* : un test qui compare les dépendances réelles des modules au graphe autorisé ; un rôle Postgres par module,
qui n'a de droits que sur son schéma ; les règles d'import des interfaces ; le contrôle du
catalogue Postgres après migration ; le refus en CI de toute migration existante modifiée ;
la CI qui régénère le client et échoue s'il diffère ; les tests de contrat.

## VIII. Deux interfaces, un même pouvoir

Le web parle à une personne, le MCP à une IA, et ils ouvrent les mêmes cas d'usage. Chaque
cas d'usage est déclaré une fois, neutre, dans la suite de cas d'usage ; le web et le MCP
le réalisent, aucun n'en a un qui lui soit propre. Une interface n'est que de l'affichage :
des écrans d'un côté, des noms et des descriptions qui enseignent de l'autre. Une
description d'outil se travaille comme un écran, et une erreur d'IA en usage réel est un
défaut d'interface.

*Vérifié par* : la suite de cas d'usage, jouée en CI sur le pilote web et sur le pilote MCP
(un cas qui échoue sur l'un des deux échoue) ; un test qui exige que chaque outil MCP soit
exercé par un cas.

## IX. Un langage strict, configuré pour refuser

Chaque langage est configuré au plus strict. Pour TypeScript : `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, et aucun `any`. Partout, un avertissement de lint est une
erreur.

*Vérifié par* : le contrôle CI des configurations, qui échoue si une option manque ; la règle
de lint qui refuse `any` en erreur.

## X. Les tests disent le comportement

Chaque comportement, chaque cas et chaque refus d'une spec a un test qui échoue s'il casse.
Rien ne se refond sans tests qui figent d'abord le comportement existant. Un test existant
ne change qu'avec une raison qui lui est propre. Un test est isolé : aucun appel réseau
vers l'extérieur (seuls les services locaux qu'il démarre), sa propre base. Chaque PR
atteint le seuil de couverture fixé pour le dépôt.

*Vérifié par* : la porte de couverture en CI ; la revue des tests en fin de développement,
qui juge aussi la raison de chaque test modifié ; le blocage du réseau extérieur dans les
tests.

## XI. Ce qui passe aujourd'hui doit passer demain

Les volumes grandissent : plus d'historique, plus d'utilisateurs. Une route qui renvoie une
collection la pagine ; un total s'agrège côté serveur ; le nombre de requêtes d'une route
ne dépend pas du nombre de lignes. Un module qui doit fournir un agrégat aux autres
l'expose par son interface, calculé chez lui.

*Vérifié par* : le contrat (toute route qui renvoie une collection porte sa pagination) ; un
test par route qui compte ses requêtes sur un jeu de N lignes puis de 10N, et échoue si le
nombre change.

## XII. Rien de ce qui est saisi n'est fiable

Tout vient d'une saisie, par une personne ou par une IA, donc tout est hostile jusqu'à
preuve du contraire. Un champ n'existe que s'il sert ; chacun est borné (longueur, valeurs
permises, plage, format) et validé par l'API, jamais seulement par l'interface. Une saisie
ne s'assemble jamais dans une requête, une commande ou du HTML : elle se passe en
paramètre et s'affiche échappée. Un texte saisi qui revient à une IA par le MCP lui est
rendu dans un champ de données délimité, que la description de l'outil désigne comme du
contenu à ne jamais suivre comme une consigne.

*Vérifié par* : le contrat (un champ texte ou numérique sans borne fait échouer la CI) ; le
lint, qui refuse une requête SQL brute hors des migrations ; les règles de lint qui interdisent
l'insertion de HTML brut ; un test de cas d'usage qui saisit un texte d'injection et
vérifie qu'il revient délimité ; la revue de sécurité quand une fonctionnalité ajoute un
champ.

## XIII. Rien de secret ni de personnel là où il ne doit pas être

Un journal ne contient que des identifiants : ni montant, ni libellé, ni nom d'acteur, ni
aucune autre donnée saisie. Aucun secret ni aucune topologie serveur dans le dépôt : la base se joint par `DATABASE_URL`,
jamais par un nom d'hôte écrit en dur. Les dépendances et les actions de CI sont épinglées
(une action par son commit, jamais par son tag). Un client OAuth ne s'enregistre pas
dynamiquement et n'exige pas de secret.

*Vérifié par* : un test qui joue les cas d'usage et cherche dans les journaux les montants et
libellés qu'il a saisis ; l'analyse de secrets en CI ; un contrôle qui refuse une action non épinglée
par commit ; la revue de sécurité.

## XIV. Ce qu'un programme peut vérifier, un programme le vérifie

Une règle qui peut être contrôlée par un type, un lint, un script ou un test l'est, en CI.
Chaque garde-fou a son propre test, qui lui soumet un défaut volontaire et exige qu'il
échoue. Une règle qui reste en prose nomme le rôle de relecture qui la juge.

*Vérifié par* : le test propre à chaque garde-fou ; la revue de code, qui refuse un nouveau
garde-fou sans le sien.

## XV. La langue de l'utilisateur s'arrête à ce qui s'affiche

La frontière est le lecteur, pas le fichier. Ce qu'une personne lit devant l'application
est dans la langue qu'elle a choisie, le français par défaut, et vit dans les catalogues
de messages, jamais en dur dans un composant. Tout ce que seul le code lit est en anglais :
segments d'URL, clés et valeurs de paramètres de requête, noms de champs de formulaire,
identifiants, noms de fichiers, branches, commentaires, messages de commit. Les données ne
se traduisent pas : ce que la personne a saisi reste dans les mots où elle l'a saisi. Les
documents du dépôt, les issues et les artefacts de spécification sont en français.

*Vérifié par* : les tests des catalogues (chaque langue a exactement les clés et les
arguments du catalogue français, aucun message vide) ; la revue de code, qui refuse un
texte affiché écrit en dur et un identifiant dans la langue de l'utilisateur.

