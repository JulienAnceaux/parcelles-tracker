# SPEC — Parcelles Tracker

## Objectif métier

Outil de **prospection foncière amont** pour Domus VirtualImmo (agence immobilière, Pontoise 95, spécialisée en visite immersive 3D). Le but n'est pas de lister toutes les parcelles d'une commune, mais d'identifier des **terrains nus détenus par des sociétés privées** (SCI, SCCV en priorité) pour approcher les propriétaires potentiellement vendeurs *avant* la mise en concurrence des portails d'annonces.

Contexte complet et raisonnement métier : voir `README_Domus_Parcelles_Tracker.md` (fourni par Julien, origine ChatGPT/Codex).

## Source de données

API Koumoul / data.gouv.fr — fichiers MAJIC "personnes morales" (DGFiP, open data depuis mars 2021). Requêtée en direct par `api/parcelles.mjs` (pas de téléchargement Parquet local dans cette version web — contrairement au pipeline DuckDB original, ici tout est en HTTP au moment de la recherche).

## Logique de qualification (`api/parcelles.mjs`)

- `nature_culture` → catégorie cadastrale non-bâti (AB = terrain à bâtir, J = jardin, AG = agrément, etc.)
- `code_droit` → `estProprietaire` si le droit "P" est présent
- `holderQualification()` → classe chaque titulaire en public/parapublic, association, SCCV, SCI, professionnel immobilier probable, ou entreprise générique (considérée privée par défaut, sauf détection publique/associative)
- `EXCLUDED_SIRENS` (actuellement vide) → à compléter manuellement par Julien pour exclure les gros acteurs institutionnels qui échapperaient à la détection automatique

## Filtres par défaut (interface)

Ces défauts reproduisent le filtrage du script d'origine (DuckDB) :

- **Nature** : "Terrain à bâtir + Jardin + Agrément" (codes AB/J/AG) — exclut agricole, boisé, et surtout tout ce qui pourrait être bâti
- **Propriétaire** : "Cibles privées probables" (`estPriveProbable`) — exclut public/parapublic et associations
- **Surface min.** : 150 m² — élimine les résidus de parcellement technique
- Tous ajustables par l'utilisateur via les menus

## Système de priorité

| Badge | Type détecté | Signal |
|---|---|---|
| ★★★ | SCCV | Véhicule créé exclusivement pour un programme immobilier — signal le plus fort |
| ★★ | SCI | Détention patrimoniale, réserve foncière probable |
| ★ | Autre | À qualifier au cas par cas |

Tri par défaut : priorité puis catégorie cadastrale puis surface décroissante.

## Suivi de prospection (CRM léger)

Ajouté pour combler l'écart avec le README (le premier déploiement n'avait que la recherche/filtrage, pas le suivi) :

- Statut par parcelle : À étudier / Contacté / RDV pris / Sans intérêt / Mandat signé
- Notes libres par parcelle
- Horodatage de dernière mise à jour
- Filtre par statut dans la barre de filtres
- Export CSV inclut priorité, statut, notes

**Stockage : `localStorage` du navigateur**, clé `parcelles-tracker:tracking:v1`, par entrée `{commune}|{id parcelle}`. Choix assumé, pas une limitation à corriger : l'outil est pensé pour un usage individuel (un client/agent = une instance), pas pour un partage d'équipe sur les mêmes prospects. Si ce cas d'usage change un jour, migrer vers une base côté serveur (Vercel KV/Postgres).

## Badge "Déjà bâti"

`api/parcelles.mjs` expose `estBati` (vrai si le code cadastral brut contient "S" = Sol occupé par une construction). Affiché dans le tableau à côté de la catégorie et dans la fiche détail. Sert de garde-fou quand le filtre "Nature" est élargi à "Toutes les natures" : un titulaire SCI/SCCV à priorité ★★★/★★ peut très bien détenir un bien déjà construit (cf. diagnostic Pontoise — sur un échantillon de 294 parcelles SCI/SCCV, 82% étaient déjà bâties, 17% réellement vacantes).

## Écarts connus avec le README d'origine

- Pas de scope fixe sur les 7 communes cœur de cible (recherche libre par commune à la place) — pas d'élargissement automatique aux 97 communes de la zone de chalandise
- Pas de croisement PermisAPI / DVF pour un score composite (piste listée dans "Perspectives" du README, non implémentée)
- Formes juridiques filtrées par heuristique de nom/forme abrégée plutôt que par la liste exacte de `forme_juridique_libelle` utilisée dans le script DuckDB d'origine
- `EXCLUDED_SIRENS` vide — la liste d'exclusion manuelle des institutionnels reste à construire

## Déploiement

Vercel, projet `parcelles-tracker`, équipe `jac-digital`. Déployé directement via l'API Vercel (pas de dépôt Git connecté à ce jour — à faire si un suivi de versions/historique est souhaité).
