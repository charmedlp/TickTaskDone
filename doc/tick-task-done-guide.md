# Tick Task Done — Guide complet du projet

> Ce document est la référence unique du projet. Il contient tout ce qu'il faut
> pour comprendre l'application et la construire de bout en bout, sans aucune
> connaissance préalable. Il se lit dans l'ordre.
>
> Le projet est codé **en anglais** (variables, commentaires, fichiers). Seul ce
> guide est en français.

---

## Table des matières

1. [Le projet en bref](#1-le-projet-en-bref)
2. [Le produit final attendu](#2-le-produit-final-attendu)
3. [Constitution du projet (règles non négociables)](#3-constitution-du-projet)
4. [Technologies](#4-technologies)
5. [Architecture générale](#5-architecture-générale)
6. [Structure du dépôt](#6-structure-du-dépôt)
7. [Modèle de données](#7-modèle-de-données)
8. [Feuille de route détaillée (ordre d'exécution)](#8-feuille-de-route-détaillée)
9. [Décisions de conception et justifications](#9-décisions-de-conception-et-justifications)
10. [Risques et points d'attention](#10-risques-et-points-dattention)

---

## 1. Le projet en bref

**Tick Task Done** est un outil personnel de gestion du temps, accessible sur
navigateur et sur Android. Le nom est un jeu de mots avec « Tic Tac Toe » et
réunit les trois facettes du produit :

- **Tick** — la facette *horaire* (comme dans « tick-tock »), le calendrier ;
- **Task** — la facette *tâches* ;
- **Done** — la facette *suivi du temps passé* et *statistiques*.

Il naît d'un constat : les outils existants échouent chacun sur un point. Google
Calendar gère mal les projets multi-tâches ; Notion est trop peu cadré ; TickTick
(le concurrent le plus proche) ne fait ni la dualité horaire prévu/réel, ni le
découpage d'une tâche en plusieurs créneaux, ni les événements bloquants, ni la
hiérarchie de projets avec taux horaire, ni les dépendances entre tâches.

L'application est aussi pensée, dès l'architecture, pour pouvoir devenir un jour
un **produit en ligne multi-utilisateurs**.

---

## 2. Le produit final attendu

Le produit fini doit offrir l'ensemble des fonctionnalités suivantes.

### Calendrier et édition
- Vue calendrier avec plusieurs affichages (jour, semaine, mois, liste
  chronologique), le calendrier étant la vue par défaut de l'application.
- Glisser-déposer des éléments, étirement (redimensionnement) et **ALT-hold pour
  copier** un élément.
- Couleurs distinctes selon le projet ou la catégorie.
- Événements pleine-journée et éléments s'étalant sur plusieurs jours.
- Événements **bloquants** (aucun chevauchement permis) et non-bloquants.
- Bascule fluide entre **horaire prévu** et **horaire réel**.
- Toute fonctionnalité doit être accessible **sans changer de vue** (via des
  actions contextuelles : clic droit / appui long).

### Éléments (items)
- Trois natures : événements, tâches éphémères (sans projet), tâches de projet.
- Découpage d'une tâche en plusieurs créneaux (« faite en 4 temps »).
- Date limite (`dueDate`) sur les tâches et les éphémères (pas sur les événements).

### Projets
- Hiérarchie de projets et sous-projets à profondeur libre (les « phases »).
- Revenu (`income`) par nœud, permettant de calculer un **taux horaire**
  (revenu ÷ heures réelles), avec cumul (rollup) sur l'arbre.
- Statuts (actif, en pause, terminé, annulé, archivé).

### Catégories
- Tags **hiérarchiques** (ex. Personnel → Ménage → Salle de bain).
- Plusieurs catégories assignables à un même item ou projet.
- Cumul de statistiques remontant l'arbre (taguer la feuille suffit).

### Récurrence
- Récurrence de tâches et d'événements (standard RFC 5545).
- Récurrence non-permanente (ex. « les 8 prochaines semaines »).
- Exceptions : sauter ou déplacer une occurrence précise.

### Dépendances
- Une tâche peut dépendre de plusieurs autres, et inversement (graphe orienté).
- Priorité automatique par tri topologique.
- Avertissement lorsqu'on tente de planifier une tâche avant un prérequis non fait.

### Suivi du temps et rappels
- Chronomètre (démarrage/arrêt) et saisie manuelle du temps réel.
- Suivi du temps par tâche et par projet.
- Moteur de rappels : tout item encore « à faire » dont la date limite est
  dépassée est signalé ; quand l'occurrence suivante d'une série arrive,
  l'occurrence précédente restée « à faire » est automatiquement annulée.

### Statistiques
- Temps par projet, catégorie, tag.
- Taux horaire par projet.
- Comparaison estimé vs réel.

### Multi-plateforme
- Web (PWA) et Android.
- Widget Android avec ajout rapide sur l'écran d'accueil.
- Notifications Android.

### Comptes et collaboration (à terme)
- Gestion des utilisateurs.
- Partage de projets entre utilisateurs, chacun conservant son horaire personnel.

---

## 3. Constitution du projet

Règles impératives, à respecter dans **chaque** fichier.

### Langue et nommage
- Tout le code est **en anglais** : variables, fonctions, commentaires, noms de
  fichiers.
- **Aucune abréviation** dans les noms. `scheduleItem`, pas `si`.

### TypeScript
- TypeScript **strict**. **Aucun `any`**, jamais.

### Concision du code (défini avec précision)
- Par défaut, on **inline** toute valeur utilisée une seule fois, en chaînant
  `?.` et `??`, tant que la ligne reste lisible d'un coup d'œil et correctement
  typée. Exemple :
  ```ts
  return (occurrences.find((occurrence) => occurrence.idItemOccurrence === 4)?.loggedMinutes ?? 0) + 30;
  ```
- On **ne nomme** une variable intermédiaire **que** si elle est réutilisée
  (pour ne pas recalculer) ou si elle rend une ligne autrement illisible.
- Code **DRY** : aucune duplication de logique, on factorise.

### Vue
- Ordre des blocs dans les composants `.vue` : **`<script>` → `<template>` →
  `<style>`**, toujours.

### Ordre des opérations et cohérence
- Ordre **LRCUD** partout : **L**ist, **R**ead, **C**reate, **U**pdate,
  **D**elete. Si un fichier expose ces opérations, elles apparaissent dans cet
  ordre.
- La structure interne des fichiers similaires doit rester cohérente d'un fichier
  à l'autre.

### Sécurité et validation
- **Chaque** donnée entrante est validée (voir Zod), sans jamais se reposer
  uniquement sur les protections de la base de données.
- Code de haute qualité et défensif.

### Base de données et SQL
- Le maximum de **filtrage, d'agrégation et de jointures** se fait en MySQL
  (rapide) ; la **logique métier** (matérialisation des occurrences, expansion
  des récurrences, résolution du graphe de dépendances) reste en TypeScript, où
  elle est testable et typée.
- **Pas de multi-statement SQL** (risque d'injection ; incompatible avec Drizzle).
  Pour limiter les allers-retours : **jointures**, **transactions** Drizzle et
  **CTE**.
- Le SQL écrit à la main (CTE récursives, gardes anti-cycle) passe par le helper
  ``sql`...` `` de Drizzle (donc entre backticks).

### Appels réseau et base
- Minimiser les allers-retours **front ↔ back** et **back ↔ base**. Si plusieurs
  informations sont nécessaires en même temps, un **seul** appel qui les retourne
  toutes est préférable à plusieurs appels.

### Dépendances externes
- **Maison par défaut.** On ne dépend d'un module externe que lorsqu'il *renforce*
  le projet au lieu de le fragiliser. Exceptions approuvées :
  - **Authentification** (le chiffrement maison est un piège de sécurité) ;
  - **`rrule`** (gère les innombrables cas limites du RFC 5545) ;
  - **Zod** (validation typée, source de vérité unique).
- **Aucun framework visuel** (pas de Bulma, Tailwind, Bootstrap...). Le **CSS est
  écrit à la main**.
- Le **calendrier est entièrement custom** — aucune librairie de calendrier, car
  les interactions (ALT-copie, étirement) sont trop spécifiques de toute façon.

---

## 4. Technologies

| Couche | Choix | Rôle |
|---|---|---|
| Frontend | Vue 3 (Composition API) en PWA (Vite) | Accès navigateur + installable |
| État | Pinia | Gestion d'état |
| Routing | Vue Router | Navigation SPA |
| Tests front | Vitest | Tests unitaires |
| Qualité | ESLint + Prettier | Justesse + mise en forme |
| Mobile | Capacitor | Emballe la PWA en app Android |
| Widget | Module Kotlin natif | Widget d'écran d'accueil |
| Backend | Node.js + Express (TypeScript) | API HTTP |
| Accès BD | Drizzle ORM + drizzle-kit | Requêtes typées + migrations |
| Driver | mysql2 (mode pool) | Connexion MySQL |
| Base | MySQL 8.4 (Docker en dev) | Données ; CTE récursives |
| Récurrence | librairie `rrule` | Expansion RFC 5545 |
| Validation | Zod | Validation + inférence de types |

**Clés primaires** : entiers auto-incrémentés (index clusterisé monotone, FK
compactes). **Authentification** : minimale au départ ; table `user` mince avec
un `externalAuthId` pour brancher un fournisseur externe plus tard sans toucher
au reste.

---

## 5. Architecture générale

- **Frontend PWA (Vue 3)** pour le navigateur, **emballé par Capacitor** pour
  Android. Une PWA ne peut pas fournir de widget d'écran d'accueil Android : seul
  ce widget (et son ajout rapide) est écrit en **Kotlin natif**. ~90 % du code
  reste donc web.
- **Backend Express** exposant une API REST, avec **Drizzle** sur **MySQL**.
- **Paquet `shared`** contenant les DTO (contrats d'API) et schémas Zod partagés,
  sans aucune dépendance à la base.
- **Modèle d'appartenance à deux niveaux** :
  - *Définitionnel* (workspace, category, project, item) → appartient à un
    **workspace**. Les éléments personnels vivent dans le **workspace personnel**
    de l'utilisateur (créé automatiquement).
  - *Ordonnancement personnel* (timeBlock, timeLog) → appartient à un **user**.
    Ainsi, sur un projet partagé, le travail est commun mais chacun a son horaire.

---

## 6. Structure du dépôt

Monorepo géré par **npm workspaces**.

```
tick-task-done/
├── .gitignore
├── .editorconfig
├── .prettierrc
├── .prettierignore
├── docker-compose.yml          # MySQL 8.4 en développement
├── package.json                # workspaces + scripts globaux
│
├── frontend/                   # Vue 3 + Vite (PWA), enveloppé par Capacitor
│   ├── src/
│   └── android/                # généré par Capacitor (Kotlin + widget)
│
├── backend/                    # Express + Drizzle + MySQL
│   ├── drizzle.config.ts
│   ├── eslint.config.mjs
│   ├── .env                    # DATABASE_URL (ignoré par git)
│   ├── .env.example
│   └── src/
│       ├── db/
│       │   ├── schema.ts       # les 12 tables
│       │   ├── db.ts           # pool mysql2 + drizzle()
│       │   └── migrations/     # généré par drizzle-kit (à committer)
│       ├── modules/            # un dossier par entité (voir Phase 2)
│       ├── middleware/
│       └── index.ts            # bootstrap Express
│
└── shared/                     # DTO + schémas Zod partagés (aucune dépendance BD)
    └── src/
```

---

## 7. Modèle de données

### Principes fondateurs

- **Définition vs occurrence.** `item` est la *définition* (récurrente ou non) ;
  `itemOccurrence` est l'*état* d'une instance (`status`, `dueDate`). Un item non
  récurrent a une seule occurrence ; un item récurrent en a plusieurs.
- **Occurrences virtuelles.** Les occurrences futures d'une série ne sont **pas**
  stockées : elles sont calculées à la volée à partir de `item.rrule` et de
  `item.recurrenceStart`. Une occurrence ne devient une ligne (« matérialisée »)
  que lorsqu'on agit dessus.
- **L'occurrence sert de mécanisme d'exception.** Une occurrence matérialisée
  prime sur la version virtuelle du même slot (`occurrenceDate`). Sauter une
  occurrence = la matérialiser en `status = cancelled` ; la déplacer = la
  matérialiser avec un `timeBlock` à une autre heure. Aucune table d'exceptions
  n'est nécessaire.
- **Prévu vs réel.** `timeBlock` = placement *prévu* (plusieurs par occurrence =
  découpage). `timeLog` = temps *réel*. La bascule prévu/réel consiste à afficher
  les `timeBlock` ou les `timeLog`.
- **Récurrence en deux champs.** `recurrenceStart` (l'ancre, le `DTSTART`) et
  `rrule` (le motif, `FREQ`/`INTERVAL`/fin). Les deux sont null ensemble (non
  récurrent) ou remplis ensemble (contrainte `CHECK`). La fin de récurrence
  (non-permanente) est encodée dans la `rrule` (`COUNT` ou `UNTIL`).
- **Tâches éphémères.** Une tâche éphémère est une tâche du projet par défaut
  « Liste de tâches » (créé automatiquement par workspace). `projectId` reste
  nullable au niveau schéma ; « éphémère = tâche de la Liste de tâches » est une
  convention produit. Cela donne un **backlog** aux tâches non planifiées.
- **Événements.** Un événement a toujours au moins un `timeBlock` (un événement
  *est* défini par le fait d'avoir lieu). Une date sans heure = événement
  pleine-journée (`allDay`).
- **Couleur en cascade.** `item.color` → couleur du projet (remontée dans la
  hiérarchie) → défaut. `item.color` est auto-rempli depuis la première catégorie
  choisie **uniquement si l'item n'a pas de projet**.

### Les 12 tables

| Table | Rôle | Colonnes clés | Appartenance |
|---|---|---|---|
| `user` | Comptes | `idUser`, `email`, `externalAuthId` | — |
| `workspace` | Espace de travail (tenant) | `idWorkspace`, `name` | — |
| `workspaceUser` | Lien user ↔ workspace (n-à-n) | `workspaceId`, `userId`, `role` | — |
| `category` | Tags hiérarchiques | `parentCategoryId`, `name`, `color` | workspace |
| `project` | Projets hiérarchiques | `parentProjectId`, `name`, `color`, `income`, `status` | workspace |
| `item` | Définition (task/event) | `type`, `projectId`, `title`, `color`, `estimatedMinutes`, `rrule`, `recurrenceStart` | workspace |
| `itemOccurrence` | État d'une instance | `itemId`, `occurrenceDate`, `status`, `dueDate` | via item |
| `timeBlock` | Placement prévu (découpage) | `itemOccurrenceId`, `timeStart`, `timeEnd`, `allDay`, `isBlocking` | **user** |
| `timeLog` | Temps réel | `itemOccurrenceId`, `startedAt`, `endedAt`, `source` | **user** |
| `itemDependency` | Graphe de dépendances (DAG) | `itemId`, `dependsOnItemId` | via item |
| `itemCategory` | Tags d'un item (n-à-n) | `itemId`, `categoryId` | via item |
| `projectCategory` | Tags d'un projet (n-à-n) | `projectId`, `categoryId` | via project |

Toutes les tables portent aussi des colonnes d'audit : `createdAt`, `updatedAt`,
`createdBy`, `updatedBy`.

### Énumérations
- `item.type` : `task` | `event`
- `itemOccurrence.status` : `todo` | `doing` | `done` | `cancelled`
- `timeLog.source` : `timer` | `manual`
- `project.status` : `active` | `onHold` | `done` | `cancelled` | `archived`
- `workspaceUser.role` : `owner` | `admin` | `member`

### Contraintes au niveau base
- `CHECK` : couple `rrule`/`recurrenceStart` (les deux ou aucun) ; `itemId <>
  dependsOnItemId` sur `itemDependency`.
- Index importants : `itemOccurrence(status, dueDate)` (rappels),
  `timeBlock(userId, timeStart)` (calendrier), paires uniques sur les jonctions.
- À ajouter en **migration SQL brute** (non exprimable en Drizzle) :
  prévention de cycles (catégories, projets, dépendances), intégrité
  même-workspace, FK d'audit vers `user`.

---

## 8. Feuille de route détaillée

Les étapes se lisent dans l'ordre. Celles marquées ✅ sont déjà réalisées. Le
**jalon MVP** (un calendrier web utilisable au quotidien) est atteint à la fin de
la Phase 5.

### Phase 0 — Initialisation ✅

1. ✅ Créer le monorepo npm workspaces (`package.json` racine listant `shared`,
   `backend`, `frontend`).
2. ✅ Ajouter `.gitignore`, `.editorconfig`, `.prettierrc`, `.prettierignore` à la
   racine (une seule source de vérité de style pour tout le dépôt ; supprimer le
   Prettier généré par le scaffold Vue).
3. ✅ Backend : `package.json` (Express, Drizzle, mysql2, dotenv), `tsconfig.json`
   (CommonJS), `eslint.config.mjs`, `drizzle.config.ts`, `.env.example`.
4. ✅ Backend : `src/db/db.ts` (pool mysql2 + `drizzle()`) et `src/index.ts`
   (Express + CORS + route `/health`).
5. ✅ Frontend : générer avec `npm create vue@latest frontend` (TypeScript, Router,
   Pinia, Vitest, ESLint, Prettier).
6. ✅ Shared : `package.json`, `tsconfig.json`, `src/index.ts` (placeholder DTO).
7. ✅ `docker-compose.yml` (MySQL 8.4, base `ticktaskdone` créée automatiquement) ;
   `docker compose up -d`.
8. ✅ Renseigner `backend/.env` (`DATABASE_URL` pointant vers `ticktaskdone`).
9. ✅ Écrire `src/db/schema.ts` (les 12 tables) ; `npm run db:generate` puis
   `npm run db:migrate`. Vérifier les tables dans un client MySQL.

### Phase 1 — Contraintes et fondations restantes ✅

1. ✅ **Triggers d'intégrité** (migration SQL brute) : fonctions stockées
   `categoryCreatesCycle` / `projectCreatesCycle` + triggers `BEFORE INSERT`/
   `BEFORE UPDATE` de **prévention de cycles** sur `category` et `project` ;
   triggers d'**intégrité même-workspace** sur `item`, `itemCategory`,
   `projectCategory`, `itemDependency`.
2. ✅ **FK d'audit** : `createdBy` / `updatedBy` → `user.idUser` (migration
   `ALTER TABLE`).
3. ✅ **Zod** installé + structure de validation (schémas dans `shared`,
   middleware `validateBody` réutilisable côté backend).
4. ✅ **Amorçage** : `createUserWithDefaults` crée, dans une transaction, le
   workspace personnel + la ligne `workspaceUser` + le projet « Task List ».

> **Reporté à la Phase 7** : la prévention de cycles du **DAG `itemDependency`**
> (au-delà de l'auto-dépendance, déjà bloquée par un `CHECK`). La détection de
> cycle dans un graphe est plus complexe qu'un parcours d'ascendance simple, et
> les dépendances ne sont construites et testables qu'en Phase 7.

### Phase 2 — Couche d'accès et premier CRUD backend ✅

1. Définir la **structure d'un module** backend, cohérente pour toutes les
   entités : par entité (`category`, `project`, `item`, `itemOccurrence`), un
   dossier `modules/<entité>/` contenant les routes, le service (accès Drizzle),
   le schéma de validation Zod, et le mapping ligne → DTO. Les opérations
   respectent l'ordre **LRCUD**.
2. **Middleware de scoping** : résoudre l'utilisateur courant et restreindre
   toute requête aux workspaces dont il est membre. Pour l'instant, un middleware
   **`currentUser` temporaire injecte un utilisateur de test codé en dur** (celui
   créé par `createUserWithDefaults`) ; il sera remplacé par la vraie
   authentification en Phase 10 sans toucher au reste du code, qui ne dépend que
   de `currentUser`.
3. **Middleware de validation** (Zod) et **middleware de gestion d'erreurs**
   centralisé (réponses cohérentes, pas de fuite d'information).
4. Implémenter le **CRUD (LRCUD)** de `category`, `project`, `item`,
   `itemOccurrence`.
5. **Helper de résolution de couleur** (cascade décrite en §7), côté backend ou
   partagé.

### Phase 3 — Récurrence et occurrences (logique backend) ✅

1. **Expansion des récurrences** : à partir de `item.rrule` + `recurrenceStart`,
   générer les occurrences virtuelles pour une fenêtre de dates donnée (via la
   librairie `rrule`).
2. **Fusion virtuel/matérialisé** : pour chaque slot, si une `itemOccurrence`
   existe sur ce `(itemId, occurrenceDate)`, elle prime ; sinon on renvoie la
   version virtuelle.
3. **Matérialisation paresseuse** : matérialiser une occurrence lorsqu'on agit
   dessus (compléter, déplacer, sauter, logger du temps).
4. **Déviations** : sauter (matérialiser `cancelled`) et déplacer (matérialiser
   avec `timeBlock` déplacé, `occurrenceDate` = slot d'origine).
5. **Moteur de rappels** : requête `itemOccurrence` où `status = todo AND dueDate
   < NOW()` ; quand l'occurrence suivante d'une série arrive, annuler les
   précédentes restées `todo`.

### Phase 4 — Frontend : calendrier custom (cœur, MVP)

1. Structurer l'app Vue : deux vues principales, **Calendrier** (défaut) et
   **Projets** ; router et stores Pinia.
2. **Couche client API** typée, consommant les DTO de `shared`.
3. **Composant calendrier maison** : affichages jour / semaine / mois / liste
   chronologique. Aucune librairie de calendrier.
4. Rendu des `timeBlock` avec la couleur résolue ; événements pleine-journée et
   multi-jours.
5. **Interactions** : création, glisser-déposer, redimensionnement, puis les
   gestes spécifiques — **ALT-hold pour copier** et **étirement fin** — via des
   gestionnaires de `pointer events` maison.
6. **Formulaires** de création/édition (événement, tâche, tâche de projet), avec
   catégories, projet, couleur.
7. **Bac latéral des tâches non planifiées** (backlog) d'où l'on glisse vers le
   calendrier.
8. **Actions contextuelles** (clic droit / appui long) : toute fonction est
   accessible sans changer de vue.

> **Décision produit à trancher ici (écran sous les yeux) :** faut-il
> **matérialiser les occurrences récurrentes échues jamais touchées** pour
> qu'elles génèrent des rappels ? Aujourd'hui, une série jamais actionnée
> (« passer la balayeuse tous les vendredis » qu'on ignore) n'a aucune ligne,
> donc aucun rappel — ce qui contredit la promesse « tout item todo en retard
> est rappelé ». La piste : matérialiser en `todo` les slots échus dans
> `runReminderMaintenance` (l'expansion jusqu'à `now` y existe déjà) avant
> l'auto-annulation. À décider en voyant le volume de lignes et l'UX réels.

> ✅ **Jalon MVP** atteint ici : calendrier web mono-utilisateur pleinement
> utilisable.

### Phase 5 — Suivi du temps et bascule prévu/réel

1. **`timeLog`** : chronomètre (démarrage/arrêt) et saisie manuelle, déclenchables
   directement depuis un bloc du calendrier (action contextuelle, pas de module
   séparé).
2. **Bascule prévu ↔ réel** : afficher les `timeBlock` ou les `timeLog`.
3. **Découpage** d'une tâche en plusieurs `timeBlock`.

### Phase 6 — Android (Capacitor)

1. Emballer la PWA avec Capacitor ; générer et construire le projet Android.
2. **Notifications locales** planifiées (rappels), via le plugin Capacitor.

### Phase 7 — Dépendances et hiérarchies

1. **CRUD `itemDependency`** (LRCUD) + **garde anti-cycle du DAG** (reportée de la Phase 1) + calcul de **priorité par
   tri topologique**.
2. **Avertissements front-end** : bloquer/alerter quand on planifie une tâche
   avant un prérequis encore `todo`.
3. **UI des hiérarchies** projets et catégories ; requêtes de **rollup** (CTE
   récursives) pour le temps et le revenu cumulés.

### Phase 8 — Statistiques

1. Requêtes d'**agrégation** : temps par projet / catégorie / tag, **taux
   horaire** par projet (revenu ÷ heures réelles), **estimé vs réel**.
2. **Tableau de bord** et graphiques (visuels maison).

### Phase 9 — Widget natif Android

1. Écrire un `AppWidgetProvider` en **Kotlin** avec **ajout rapide** depuis
   l'écran d'accueil (deep-link vers l'app ou appel direct à l'API).

### Phase 10 — Multi-utilisateurs / SaaS

1. **Authentification réelle** : remplacer le middleware `currentUser`
   temporaire par une identité authentifiée. Candidat privilégié :
   **Better Auth** (TypeScript, client Vue officiel, compatible Express,
   écrit dans notre MySQL via un adaptateur Drizzle, open-source et
   auto-hébergeable, avec un système d'**organisations** qui recouvre le
   concept de workspace) ; alternative managée : **Kinde** ; à éviter :
   **Stack Auth** (orienté React/Next). Réconcilier avec la table `user`
   via `externalAuthId`. Comme tout le code ne dépend que de `currentUser`,
   aucun autre fichier ne change.
2. **Partage de projets** : ajout de membres dans `workspaceUser`, invitations,
   UI. Aucune modification de schéma nécessaire (l'appartenance par workspace est
   déjà en place).

### Phase 11 — Qualité, tests et déploiement

1. Tests (Vitest côté front ; tests d'intégration backend). Tests bout-en-bout
   (Playwright) si souhaité, une fois le calendrier stable.
2. Choix de l'hébergement de production : **MySQL managé qui respecte les clés
   étrangères** (ex. TiDB Cloud Serverless, AWS RDS). **Éviter PlanetScale** (ne
   les applique pas).
3. Restreindre le CORS aux origines autorisées.

---

## 9. Décisions de conception et justifications

- **Modèle `item` unifié** (task/event) : évite la duplication de champs et donne
  une seule clé étrangère pour `timeLog`.
- **Calque `itemOccurrence`** : le statut est propre à chaque instance, pas à la
  définition — sans lui, une tâche récurrente n'aurait qu'un seul statut pour
  toutes ses occurrences. Il remplace aussi la table d'exceptions.
- **`timeBlock` séparé de l'occurrence** : porte le découpage (1 occurrence : N
  créneaux). Un événement simple reste un 1:1 (surcoût minime assumé) ; fusionner
  casserait le découpage.
- **`occurrenceDate`** : simple ancre de slot d'une récurrence, `null` pour un
  item non récurrent ; la vraie date vit dans le `timeBlock`, donc aucun doublon.
- **`recurrenceStart` en colonne dédiée** (plutôt que déduit de la plus petite
  occurrence) : l'ancre doit être stable et connue *avant* toute matérialisation ;
  la déduire d'une occurrence créerait un problème d'œuf et de poule et
  dériverait si des occurrences sont supprimées.
- **Appartenance workspace vs user** : le travail est partageable, l'horaire est
  personnel. Les items persos vivent dans le workspace perso → modèle uniforme,
  sans cas particulier, et partage futur sans refonte.
- **Hiérarchie de projets = phases dynamiques** ; **catégories = tags
  hiérarchiques transverses** : deux axes complémentaires (structure vs facettes).
- **Drizzle plutôt que Prisma** : SQL-first et typé, exprime les `CHECK` dans le
  schéma, échappatoire SQL brut (CTE) restant paramétrée et typée. Adapté à un
  développeur à l'aise en SQL.
- **PK auto-incrémentées** : index clusterisé monotone et FK compactes sur MySQL.
- **Pool mysql2** : concurrence réelle et remplacement automatique des connexions
  mortes.
- **PWA + Capacitor** : un seul codebase web, seul le widget d'accueil exige du
  natif Kotlin.

---

## 10. Risques et points d'attention

- **Interactions calendrier custom** (ALT-copie, étirement) : aucune librairie ne
  les fournit ; couche de `pointer events` maison. Poste le plus incertain.
- **Widget Android natif** : seul morceau hors-web, en Kotlin.
- **Récurrence** : commencer par les événements et éphémères récurrents avant les
  tâches de projet récurrentes ; laisser de côté le croisement **dépendances +
  récurrence** (sémantique « occurrence N de B dépend de l'occurrence N de A » à
  préciser plus tard).
- **Renommer une seule occurrence d'une série** : non couvert (le titre est sur
  `item`) ; ajouter un `titleOverride` nullable sur `itemOccurrence` si le besoin
  émerge.
- **Performance des rollups** : si les statistiques ralentissent, passer des CTE
  récursives à une **table de fermeture** (closure table) par hiérarchie.
- **Drizzle en transition v1** : figer une version et suivre les notes de release.
- **Hébergement de production** : ne retenir qu'un MySQL managé qui **applique les
  clés étrangères**.
- **`GET` à effet de bord (rappels)** : `GET /reminders` et `GET /occurrences`
  déclenchent `runReminderMaintenance`, qui **écrit** en base (auto-annulation).
  Un `GET` est censé être sans effet de bord : tout rejeu (preflight, prefetch
  navigateur, cache) provoquerait des annulations. Dette à résorber en sortant
  la maintenance en **tâche planifiée** (cron) et en rendant ces deux routes
  purement en lecture. La fonction est déjà isolée : déplacement, pas réécriture.
- **Occurrence « fantôme » à l'ancre** : une occurrence récurrente matérialisée
  dont le slot est dans la fenêtre mais dont le `timeBlock` a été déplacé hors
  fenêtre est émise avec `timeBlocks: []`. Pas un bug de données, une nuance de
  rendu à gérer côté calendrier en Phase 4.
- **Fuseaux horaires** : `timezone: 'Z'` est forcé sur le pool mysql2 pour que
  le round-trip `DATETIME` reste en UTC (sinon un décalage casserait le masquage
  virtuel↔matérialisé et produirait des doublons). À retester dès que la base
  tourne en conditions réelles.