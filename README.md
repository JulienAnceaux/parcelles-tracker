# Parcelles Tracker

MVP de veille foncière fondé sur les données ouvertes MAJIC des personnes morales diffusées via Koumoul.

## Fonctionnement

- Recherche de commune via le référentiel officiel `geo.api.gouv.fr`
- Appel à Koumoul uniquement depuis le backend Vercel
- Recherche exacte par code INSEE
- Nomenclature cadastrale corrigée (`AB`, `J`, `AG`, etc.)
- Filtrage des titulaires déclarés propriétaires
- Export CSV
- Authentification temporaire par mot de passe serveur

## Limite importante

Une nature cadastrale, y compris `AB – Terrains à bâtir`, ne prouve pas la constructibilité actuelle. Le PLU/PLUi, les servitudes et les contraintes opérationnelles doivent être vérifiés.

## Variables

Copier `.env.example` vers `.env.local`, puis définir :

- `PASSWORD` (ou `APP_PASSWORD`)
- `APP_SESSION_SECRET` (24 caractères minimum)

## Prochaine étape

Ajouter une base PostgreSQL pour les comptes, listes, statuts, notes et historiques, puis connecter le zonage du Géoportail de l’Urbanisme.
