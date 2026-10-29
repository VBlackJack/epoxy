# EPOXY - Jeu de logique sur grille

*English version: [README.md](./README.md)*

**Jouer en ligne :** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** est un jeu de puzzle à tuiles pour navigateur, dans l'esprit des jeux de réflexion portables de l'époque Atari Lynx, écrit en TypeScript avec HTML5 Canvas et la Web Audio API.

## Fonctionnalités

- **Des centaines de niveaux inclus** :
  - **Campagne Epoxy** : 20 niveaux Epoxy, scénarisés dans `tools/campaign-script.json` et tous prouvés solvables : ils enseignent une mécanique à la fois, s'ouvrent en hubs aux ailes verrouillées à partir du niveau 3, et ajoutent des salles de blocs façon Sokoban à partir du niveau 13.
  - **Packs communautaires fournis** : `Tile World Intro` et `CCLP 1` à `CCLP 5` (voir [Crédits](#crédits)).
  - **Formats `.DAT` / `.CCL` / `.JSON`** : import et export par glisser-déposer de packs au format binaire CC1 `.DAT`, très répandu. Les packs que vous possédez s'importent de cette façon.
  - **Générateur procédural prouvé** : assemble les niveaux à partir de pièces d'énigme dessinées à la main (`public/configs/motifs.json`), chacune prouvée équitable et solvable par un solveur qui fait tourner le vrai moteur du jeu. Chaque niveau généré est ensuite rejoué du début à la fin avant d'être proposé : il est toujours solvable et aucune énigme ne peut être contournée. Difficulté, thème et rythme progressent avec le numéro du niveau. À partir du niveau 3, les niveaux sont des hubs aux ailes verrouillées dont les clés et les bottes se trouvent dans d'autres ailes ; la forme du hub (`procedural.hub.shapes` dans `game.json`) et les salles récompense varient, et avec le biome sur Auto chaque niveau prend l'ambiance de sa mécanique principale. Dans les énigmes de blocs, le bouton Aide joue la poussée suivante, et le jeu signale une impasse dès qu'elle est prouvée.
  - **Voir la solution** (`O`) : chaque niveau de la campagne et chaque niveau généré conserve la solution rejouée par sa preuve. Le bouton recommence le niveau et joue cette solution jusqu'à la sortie ; la regarder n'enregistre aucun score.
- **Moteur complet de tuiles et de monstres** :
  - Dangers élémentaires (`water`, `fire`, `ice` avec déflecteurs d'angle, convoyeurs `force`, `bomb`).
  - Mécanismes interactifs (`button_green`, machines à cloner `button_red`, pièges `button_brown`, inverseurs de tanks `button_blue`, téléporteurs `teleport`, `thief`).
  - 9 comportements de créatures (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Rendu et commandes** :
  - Moteurs de rendu HD Neon et Retro 16 bits avec 4 thèmes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`).
  - Localisateur d'objectif et affichage des câblages de mécanismes (`H`).
  - Support tactile complet sur smartphone (joystick virtuel par glissement, déplacement par toucher, zoom à deux doigts, croix directionnelle avec retour haptique).
  - Éditeur de niveaux 32x32 complet avec validation en direct par le solveur.

## Développement

Nécessite Node.js 24 (voir `.nvmrc`).

```bash
npm install
npm run dev
```

## Construire une campagne avec le générateur

1. Ouvrez l'**Éditeur de niveaux**, choisissez une **Difficulté**, laissez la **Graine** vide et cliquez sur **Générer**. La graine utilisée s'affiche, ce qui permet de régénérer le même niveau.
2. Retouchez le niveau, puis **testez**-le.
3. **Exportez en JSON** et collez l'objet exporté dans le tableau `levels` de `public/configs/levels.json`. Un niveau exporté se charge tel quel ; ajustez `number` selon la position voulue.

La campagne Epoxy elle-même est décrite niveau par niveau dans `tools/campaign-script.json` (motifs à enseigner, nombre d'énigmes, palier maximal) ; `npm run build:campaign` génère chaque niveau, le prouve et réécrit `public/configs/levels.json` en lignes de légende lisibles.

Les nouvelles pièces d'énigme se placent dans `public/configs/motifs.json` ; lancez ensuite `npm run annotate:pieces` pour précalculer la solution et la réversibilité de chaque pièce dans `public/configs/motif-annotations.json`, que le générateur lit au lieu de chercher dans le navigateur.

Salles Sokoban : `npm run forge:sokoban` en fabrique d'originales en partant de leur solution (des blocs sur des boutons marron qui maintiennent ouverts les pièges de sortie). `npm run import:sokoban` adapte une collection au format standard `.xsb` (renseignez `EPOXY_SOKOBAN_FILE` et `EPOXY_SOKOBAN_CREDIT`) ; n'utilisez que des collections dont la licence autorise la réutilisation, et conservez le crédit. Les deux écrivent des candidates dans `local/` pour le tri. `npm test` vérifie que chacune est solvable dans toutes les orientations, qu'aucun bloc ne peut sortir par ses ports et que rien n'y est décoratif ; `npm run report:pieces` écrit la solution de chaque pièce dans `local/piece-probe.txt`.

## Tests

```bash
npm test
```

`npm run report:levels` mesure 200 niveaux générés en les comparant aux packs communautaires fournis, et écrit `reports/level-metrics.json`. `npm run report:study` décrit comment les packs communautaires combinent les mécaniques, et `npm run mine:pieces` cherche des pièces d'énigme plus difficiles (environ une demi-heure) ; les deux écrivent dans `local/`.

## Build de production

```bash
npm run build
```

## Crédits

Les packs `CCLP 1` à `CCLP 5` fournis sont des jeux de niveaux créés par la communauté, et `Tile World Intro` est distribué avec le projet Tile World. Tous les niveaux de ces packs restent l'oeuvre de leurs auteurs respectifs. Epoxy n'est affilié à aucun détenteur de jeu commercial.

## Licence

Copyright 2026 Julien Bombled. Le code source d'Epoxy est publié sous [licence Apache 2.0](./LICENSE). Les packs de niveaux fournis ne sont pas couverts par cette licence.
