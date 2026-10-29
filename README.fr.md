# EPOXY - Jeu de logique sur grille

*English version: [README.md](./README.md)*

**Jouer en ligne :** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** est un jeu de puzzle à tuiles pour navigateur, dans l'esprit des jeux de réflexion portables de l'époque Atari Lynx, écrit en TypeScript avec HTML5 Canvas et la Web Audio API.

## Fonctionnalités

- **Des centaines de niveaux inclus** :
  - **Campagne Epoxy** : les niveaux Epoxy conçus à la main.
  - **Packs communautaires fournis** : `Tile World Intro` et `CCLP 1` à `CCLP 5` (voir [Crédits](#crédits)).
  - **Formats `.DAT` / `.CCL` / `.JSON`** : import et export par glisser-déposer de packs au format binaire CC1 `.DAT`, très répandu. Les packs que vous possédez s'importent de cette façon.
  - **Générateur procédural solvable** : produit des donjons 32x32 à plusieurs ailes, vérifiés par un solveur BFS/Sokoban automatique (`LevelValidator`).
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

## Tests

```bash
npm test
```

## Build de production

```bash
npm run build
```

## Crédits

Les packs `CCLP 1` à `CCLP 5` fournis sont des jeux de niveaux créés par la communauté, et `Tile World Intro` est distribué avec le projet Tile World. Tous les niveaux de ces packs restent l'oeuvre de leurs auteurs respectifs. Epoxy n'est affilié à aucun détenteur de jeu commercial.

## Licence

Copyright 2026 Julien Bombled. Le code source d'Epoxy est publié sous [licence Apache 2.0](./LICENSE). Les packs de niveaux fournis ne sont pas couverts par cette licence.
