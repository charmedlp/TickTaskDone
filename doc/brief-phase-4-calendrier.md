# Brief de conception — Phase 4 : le calendrier (frontend)

> Complément au guide `tick-task-done-guide.md`. Ce document spécifie l'UX et le
> rendu du **calendrier**, le cœur du produit. L'agent doit s'y tenir sans rien
> inventer sur ces points ; là où le document ne tranche pas, il propose et
> signale son choix.
>
> La **vue Projets** (le second onglet de l'application) fera l'objet d'un brief
> séparé — mais elle existe, donc une **barre de navigation** doit permettre de
> basculer entre *Calendrier* et *Projets* dès maintenant.
>
> Rappels de la Constitution (§3 du guide) qui s'appliquent ici : tout en anglais,
> aucun `any`, ordre `<script>`→`<template>`→`<style>` dans les `.vue`, aucun
> framework CSS ni librairie de calendrier (**tout est custom**), et **toute
> fonctionnalité accessible sans changer de vue** (actions contextuelles).

---

## 1. Fondations de la grille

**Cinq affichages**, sélectionnables via un contrôle de vue :

- **Jour** — une colonne, grille 24 h.
- **Semaine** (défaut) — 7 colonnes, grille 24 h. Premier jour **lundi**
  (configurable).
- **Semaine ouvrable** — lundi→vendredi par défaut (configurable), **toujours
  ancrée au lundi**. Grille limitée aux heures utiles (pas 24 h).
- **Mois** — grille mensuelle classique.
- **Liste** — voir §9.

**Paramètres :**
- Snap au glisser : **15 min** par défaut (configurable).
- Grille 24 h partout **sauf** en semaine ouvrable ; au chargement d'une vue 24 h,
  défiler sur une plage utile plutôt que d'afficher minuit.
- Premier jour de semaine configurable (vue Semaine) ; la vue Semaine ouvrable
  reste ancrée au lundi quoi qu'il arrive.

Le calendrier consomme le flux fenêtré du backend
(`GET /workspaces/:id/occurrences?from=&to=`), qui renvoie déjà virtuel +
matérialisé fusionné. La fenêtre `[from, to]` correspond à la plage affichée.

---

## 2. Sémantique de l'ALT-copie (arbre de décision)

**ALT-hold + glisser un élément = le copier.** Ce que « copier » crée dépend de
la source, évalué **dans cet ordre exact** :

1. **Événement** (quel qu'il soit) → **copie simple** : nouvel `item` de type
   `event` reprenant les mêmes infos, avec sa propre occurrence + `timeBlock` à la
   destination.
2. Sinon, tâche dont le statut est **`done` ou `cancelled`** (et **non
   récurrente**) → **copie simple** : nouvelle tâche neuve reprenant les infos. On
   ne rouvre pas un chapitre clos ; l'historique de temps de la source reste
   intact.
3. Sinon, tâche **récurrente** (éphémère *ou* de projet) → **nouvelle occurrence
   custom**, hors règle de récurrence (une instance ponctuelle de plus de la même
   tâche à la destination).
4. Sinon, **tâche éphémère non récurrente** (active) → **copie simple** (une
   éphémère ne se découpe pas).
5. Sinon, **tâche de projet non récurrente** (active) → **découpage** : un
   `timeBlock` de plus **sur la même occurrence** (peu importe où on le dépose).

> Règle d'or derrière l'arbre : **copier un bloc, c'est du découpage** uniquement
> pour une tâche de projet active et non récurrente ; partout ailleurs, copier
> crée une nouvelle entité ou une nouvelle occurrence. Le geste ne dépend jamais
> de la *distance* du dépôt, seulement du type/statut/récurrence de la source.

Traduction API (indicative) : une copie simple → `POST /items` (+ occurrence +
`timeBlock`) ; une nouvelle occurrence custom → matérialisation d'un slot hors
règle + `timeBlock` ; un découpage → `POST /timeblocks` sur l'occurrence existante
(`POST /items/:idItem/occurrences/move` ou l'endpoint timeBlock selon le cas).

---

## 3. Desktop vs tactile

Android n'a ni touche ALT ni survol : chaque geste desktop a un équivalent
tactile explicite.

| Action | Desktop | Tactile |
|---|---|---|
| Déplacer | glisser | glisser |
| Redimensionner (étirer) | poignées haut/bas au survol | **tap pour sélectionner** → poignées visibles |
| Copier (ALT-copie) | ALT maintenu + glisser | action contextuelle **« Dupliquer »** (appui long) |
| Menu d'actions | clic droit | appui long |

La sélection d'un bloc au tap révèle ses poignées d'étirement et son menu
contextuel. Toute fonction (chrono, découpe, dépendance, suppression…) est
joignable par ce menu contextuel — **jamais** en changeant de vue.

---

## 4. Encodage visuel des états

- **Couleur** = projet/catégorie, via la cascade déjà définie (`item.color` →
  couleur du projet → défaut). Résolue côté serveur (`resolvedColor` du DTO).
- **Type** : une **tâche** porte une **case à cocher** ; un **événement** n'en a
  pas.
- **Fait** (`done`) : case cochée + **opacité réduite**.
- **Virtuel vs matérialisé** : **aucune différence visible** pour l'utilisateur.
  Une occurrence récurrente pas encore matérialisée se présente exactement comme
  une matérialisée. La distinction n'existe qu'au moment de l'**édition** (matériali-
  sation paresseuse déclenchée par l'action, transparente pour l'utilisateur).
- **Bloquant vs non-bloquant** : encodé par la **largeur** (voir §5), pas par une
  bordure.

---

## 5. Largeur, chevauchement et gouttière

Modèle de largeur d'une colonne de jour (exemple sur 200 px) :

- **Éléments non-bloquants** : ils se partagent une **bande de 170 px** (les 30 px
  restants forment une **gouttière** à droite, toujours cliquable pour créer une
  entrée). Un seul non-bloquant → 170 px ; deux qui se chevauchent → 85 px chacun,
  côte à côte ; trois → ~56 px chacun ; etc. Le partage suit la convention
  classique des calendriers, mais **plafonné à la bande de 170**, jamais à la
  pleine largeur.
- **Élément bloquant** : prend les **200 px** pleins (gouttière incluse) et
  **interdit tout chevauchement** sur son créneau — aucun autre élément ne peut
  s'y superposer.

La gouttière ne disparaît donc que sous un bloquant.

---

## 6. Bascule prévu / réel

Deux **affichages distincts**, commutés par un **toggle** :

- **Vue prévue** : rend les `timeBlocks` (le plan).
- **Vue réelle** : rend les `timeLogs` (le temps réellement passé), placés à leurs
  `startedAt`/`endedAt`.

Les **événements** s'affichent **identiquement** dans les deux vues (ils n'ont pas
de `timeLog`). Seules les tâches diffèrent d'une vue à l'autre.

---

## 7. Chronomètre (depuis le calendrier, sans changer de vue)

En **vue prévue**, chaque **tâche** porte une **icône de chronomètre en haut à
droite**. Flux :

1. Clic sur l'icône → un **chronomètre en overlay** s'ouvre, identifiant la tâche
   chronométrée, avec **Pause** et **Stop**.
2. Chaque **segment** (entre deux pauses) crée **un `timeLog` réel, enregistré au
   fil de l'eau** (persisté immédiatement, on connaît son id). Un crash ou une
   fermeture de page **ne perd rien**.
3. À l'**arrêt**, un **compte-rendu** liste les logs créés (un par segment) et
   propose :
   - **Valider** — ne touche pas la base (les logs sont déjà là).
   - **Fermer l'overlay** — ouvre un pop-up « Valider / Annuler » (**Valider**
     sélectionné par défaut) ; *Annuler* supprime les logs créés de la base.
   - **Saisie manuelle** — un champ de temps manuel, précédé de l'avertissement
     « Entrer un temps manuel effacera vos temps chronométrés ». La suppression des
     logs chronométrés se produit **à la validation** du temps manuel, pas avant.

La saisie manuelle passe donc **toujours** par le chrono (lancer → arrêter →
saisir) ou par l'édition de la tâche ; il n'y a pas d'autre porte d'entrée.

---

## 8. Bac latéral — le backlog

Les tâches **sans `timeBlock`** (non planifiées) vivent dans un **bac latéral** :

- Regroupées **par projet**, triées par **date limite**.
- Inclut le faux projet **« Task List »** qui héberge les tâches éphémères non
  planifiées (le backlog des tâches sans projet réel).
- **Glisser une tâche du bac vers la grille = la planifier** : matérialise
  l'occurrence si besoin et crée son `timeBlock`.

Le backlog **n'apparaît jamais dans le calendrier lui-même** (le calendrier ne
montre que ce qui a un `timeBlock`) — uniquement dans ce bac et dans la future vue
Projets.

---

## 9. Vue Liste

Liste chronologique des **`timeBlocks`**, groupés par jour :

```
15 janvier 2026
  9:00  — Passer la balayeuse
 10:00  — Laver le bain
 10:15  — Douche

17 janvier 2026
  8:00  — Rendez-vous médecin
 10:00  — Design UI Logicentre

18 janvier 2026
  Toute la journée — Anniversaire de Jérôme
  8:00  — Design UI Logicentre
```

Règles :
- On liste **tous les items** ayant un `timeBlock` dans la fenêtre, quel que soit
  leur type (événements + tâches), y compris les **occurrences virtuelles** (elles
  ont leur place normale).
- Une tâche **découpée** (plusieurs `timeBlocks`) apparaît **autant de fois**
  qu'elle a de blocs.
- Seuls les **jours ayant au moins un item** sont affichés ; les jours vides sont
  masqués.
- Les entrées **pleine-journée** apparaissent en tête de leur jour.
- Le **backlog non planifié n'apparaît pas** (pas de `timeBlock`).

---

## 10. Navigation & structure

- Barre de navigation permettant de basculer **Calendrier ↔ Projets** (la vue
  Projets sera spécifiée séparément, mais la navigation existe dès maintenant).
- Dans la vue Calendrier : sélecteur des cinq affichages (Jour / Semaine / Semaine
  ouvrable / Mois / Liste), navigation temporelle (précédent / suivant /
  aujourd'hui), et le toggle **prévu / réel**.
- Stores Pinia et couche client API typée consommant les DTO de `shared`.

---

## 11. Décision produit à trancher pendant cette phase

Rappel du guide (§8, Phase 4) : faut-il **matérialiser les occurrences récurrentes
échues jamais touchées** pour qu'elles génèrent des rappels ? Aujourd'hui une série
jamais actionnée n'a aucune ligne, donc aucun rappel — ce qui contredit la promesse
« tout item todo en retard est rappelé ». **À décider en voyant le comportement réel
du calendrier à l'écran**, pas en amont.

---

## 12. Hors périmètre de ce brief

- La **vue Projets** (brief séparé).
- Le **suivi du temps multi-blocs** avancé et les statistiques (Phases 5 et 8).
- Les **dépendances** et leurs avertissements visuels (Phase 7).
- L'**Android/Capacitor** et le widget (Phases 6 et 9) — mais le calendrier doit
  déjà être **tactile-compatible** (voir §3), car il tournera dans l'app Android.
