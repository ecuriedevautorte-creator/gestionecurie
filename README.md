# Gestion Écurie

Application de suivi de l'écurie (chevaux, soins, échéances, élevage), installable sur téléphone et utilisable hors réseau.

- Les données restent dans le téléphone (et, à partir de l'étape 3, dans la base Supabase) : **aucune donnée de l'écurie n'est dans ce dépôt**.
- Chaque modification envoyée sur `main` est testée puis publiée automatiquement sur GitHub Pages.

Pour les développeurs : `npm install`, `npm run dev`, `npm test`
(`CLASSEUR=/chemin/Gestion_Ecurie.xlsx npm test` lance aussi le test sur le vrai classeur).
