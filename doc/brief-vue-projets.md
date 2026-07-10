# Brief de conception — Vue Projets (complément Phase 4)

> Complément au `brief-phase-4-calendrier.md`, au `brief-categories.md` et au
> guide. Spécifie le **second onglet** de l'application : la vue Projets, une vue
> de **gestion** (pas encore un tableau de bord analytique).
>
> Contraintes de la Constitution rappelées : anglais, aucun `any`, ordre
> `<script>`→`<template>`→`<style>`, aucun framework CSS ni librairie externe de
> composants, validation systématique, **toute action possible sans naviguer entre
> les deux vues** (principe directeur, voir §1).

---

## 0. Principe directeur

L'utilisateur ne doit **jamais être forcé de basculer** entre Calendrier et
Projets pour accomplir une action. Le maximum de choses est faisable **des deux
côtés** ; les deux vues lisent et écrivent les **mêmes données**. La vue Projets
est le « foyer » complet de gestion ; le calendrier est la surface de planification
temporelle. C'est cette redondance maîtrisée qui distingue l'outil des
alternatives où l'on se perd entre modules.

---

## 1. Disposition — maître-détail

- **Panneau gauche — l'arbre des projets** : projets et sous-projets imbriqués,
  indentés, **repliables/dépliables**. Le faux projet **« Task List »** (foyer des
  tâches éphémères) est **épinglé**. Les projets **archivés sont masqués par
  défaut**, avec un filtre pour les réafficher.
- **Panneau droit — le détail** de l'élément sélectionné dans l'arbre :
  - si un **projet** est sélectionné → détail du projet (§2) ;
  - si une **tâche** est sélectionnée → détail éditable de la tâche (§3).

---

## 2. Détail d'un projet

En-tête : **nom, couleur, statut, income, catégories** (assignation multi-tags,
mêmes règles que le brief catégories : stockage de la feuille, affichage de
l'ascendance). Puis :

- ses **sous-projets** ;
- ses **tâches**, en **liste simple** (pas de kanban) : chaque tâche montre sa
  **case à cocher**, son **échéance**, et si elle est **planifiée ou en backlog** ;
- un bloc de **statistiques directes** (§4).

CRUD complet de l'arbre : créer un projet/sous-projet, renommer, changer la
couleur/le statut, **déplacer** un projet sous un autre parent (le trigger BD
empêche les cycles), archiver.

### `income`
Saisissable dès maintenant sur chaque projet (`DECIMAL`). **Aucun calcul de taux
horaire pour l'instant** — la valeur est stockée et affichée, rien de plus.

---

## 3. Détail d'une tâche — gestion complète des moments planifiés (Niveau 2)

La vue Projets travaille au niveau de l'**item**, mais expose et édite ses
**moments planifiés** (occurrences / blocs), pour ne jamais forcer un aller au
calendrier. On y édite les champs de la tâche (titre, description, estimation,
catégories, échéance, statut) **et** ses moments planifiés.

### 3.1 Liste des moments planifiés

Le détail d'une tâche affiche la liste de ses **moments planifiés matérialisés** —
c'est-à-dire les lignes `itemOccurrence` réelles (custom, avec `timeBlock`, ou
`done`) et leurs blocs. Les occurrences **purement virtuelles** d'une série (à
venir, générées par la règle, jamais touchées) peuvent être affichées pour
information mais ne sont pas des lignes éditables tant qu'on n'agit pas dessus
(matérialisation paresseuse au premier geste).

Opérations disponibles (elles s'appuient sur les endpoints de la Phase 3 :
matérialisation, move, status, CRUD `timeBlock`) :

- **Ajouter un moment** :
  - tâche **récurrente** → crée une **occurrence custom** (matérialisée hors règle) ;
  - tâche **non récurrente** → ajoute un **`timeBlock`** (division).
- **Supprimer un moment** → retire l'occurrence / le bloc.
- **Modifier un moment** → déplace / réédite l'occurrence ou le bloc.

**Invariant à respecter :** récurrence et division **ne coexistent jamais**. Une
tâche récurrente a une occurrence = un bloc ; une tâche divisée est non récurrente
(une occurrence, plusieurs blocs). L'opération « Ajouter un moment » ci-dessus
respecte automatiquement cet invariant (occurrence si récurrent, bloc si non).

### 3.2 Bascules de récurrence (les cas sensibles)

Activer ou retirer la récurrence transforme des données ; ces trois règles doivent
être appliquées **exactement**, chacune **précédée d'un avertissement confirmable**.

**A. Activer la récurrence sur une tâche à bloc unique** (non divisée).
Le bloc existant devient la **première occurrence** ; sa date/heure devient le
`recurrenceStart` (l'ancre). Cas doux, pas de perte. *(Avertissement facultatif.)*

**B. Activer la récurrence sur une tâche divisée** (plusieurs blocs).
Les N blocs deviennent **N occurrences custom** (hors règle) du nouvel item
récurrent, chacune avec son bloc unique — l'invariant est préservé et **rien n'est
détruit**. Le `recurrenceStart` est l'ancre posée avec la règle.
*Avertissement :* « Les divisions deviendront des instances indépendantes de la
récurrence. »

**C. Retirer la récurrence** (dé-récurrence).
Règle exacte :

> Chaque **occurrence matérialisée** devient une **tâche séparée** non récurrente.
> Une occurrence est matérialisée — et donc préservée — si elle est **custom**
> (planifiée hors règle), **ou** porte des données (**`timeBlock`** associé **ou**
> case **Done** cochée ; un `timeLog` implique déjà une occurrence matérialisée).
> Les occurrences **purement virtuelles** (générées par la règle, jamais touchées)
> **disparaissent** — on ne matérialise jamais le futur d'une série qu'on arrête.
> L'item d'origine **n'a aucun statut privilégié** : il subit le même traitement
> qu'une occurrence. Si **aucune** occurrence n'est matérialisée, la tâche est
> **supprimée** (pas de coquille vide au backlog).

*Avertissement :* « Cette tâche récurrente sera scindée en N tâches distinctes ;
les occurrences non planifiées et non faites seront perdues. » (Afficher N.)

**Verrou :** on ne mélange jamais les états. Comme l'ajout de moment respecte déjà
l'invariant et que les bascules A/B/C convertissent proprement, aucun état
« impossible » (récurrent ET divisé) ne peut être atteint.

### 3.3 Ce qui reste exclusif au calendrier

Rien d'essentiel : la gestion des moments planifiés est désormais possible des deux
côtés. Le calendrier garde ses **gestes** propres (glisser, étirer, ALT-copie
contextuelle) et la manipulation visuelle directe ; la vue Projets offre la même
puissance par formulaire/liste. Les deux surfaces écrivent les **mêmes** lignes
`itemOccurrence` / `timeBlock`, donc restent toujours synchronisées.

---

## 4. Statistiques du détail projet — placeholder

Bloc de stats affiché dans le détail d'un projet, portant sur ses **tâches
directes uniquement** (agrégation simple, **sans récursion**) :

- nombre de tâches **accomplies** et **restantes** ;
- heures **planifiées**, **estimées**, **accomplies** ;
- **% accompli en nombre de tâches** ;
- **% accompli en heures**.

> **Placeholder assumé.** Ces stats ne couvrent que le projet sélectionné, pas son
> sous-arbre. Le **cumul récursif sur les sous-projets** (temps et revenu remontant
> l'arbre) et le **taux horaire** arrivent en **Phase 7** (CTE récursives). Ne pas
> implémenter la récursion ici.

---

## 5. Gestion de l'arbre de catégories

La vue Projets héberge la **gestion des catégories elles-mêmes** (mise hors
périmètre du brief catégories) :

- créer, renommer, recolorer, **déplacer** une catégorie sous un autre parent (le
  trigger BD empêche les cycles), supprimer ;
- l'**assignation** de catégories aux **projets** (`projectCategory`) se fait dans
  le détail d'un projet (§2), avec les mêmes règles que pour les items : on stocke
  la **feuille**, on affiche l'**ascendance**.

---

## 6. Réconciliation avec le calendrier (rappel)

- Le **backlog** (tâches sans `timeBlock`) vit dans les **deux** surfaces : le bac
  latéral du calendrier **et** la vue Projets. Mêmes données.
- **Tout** est possible des deux côtés : gérer une tâche, la planifier, ajouter /
  supprimer / modifier ses moments planifiés, la diviser, activer/retirer sa
  récurrence. Les deux surfaces écrivent les mêmes lignes et restent synchronisées.
- Le calendrier conserve ses **gestes** visuels directs (glisser, étirer,
  ALT-copie) ; la vue Projets offre la même puissance par formulaire/liste. C'est
  une différence d'**ergonomie**, pas de **capacité**.

---

## 7. Hors périmètre

- **Cumuls récursifs** (temps/revenu d'un sous-arbre) et **taux horaire** → Phase 7.
- **Tableau de bord de statistiques** riche → Phase 8.
- **Dépendances** entre tâches et leurs avertissements → Phase 7.
