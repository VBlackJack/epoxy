# EPOXY - Jeu de logique sur grille

*English version: [README.md](./README.md)*

**Jouer en ligne :** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** est un jeu de puzzle à tuiles pour navigateur, dans l'esprit des jeux de réflexion portables de l'époque Atari Lynx, écrit en TypeScript avec HTML5 Canvas et la Web Audio API.

## Fonctionnalités

- **Des centaines de niveaux inclus** :
  - **Campagne Epoxy** : 20 niveaux Epoxy, scénarisés dans `tools/campaign-script.json` et tous prouvés solvables : ils enseignent une mécanique à la fois, s'ouvrent en hubs aux ailes verrouillées à partir du niveau 3, et ajoutent des salles de blocs façon Sokoban à partir du niveau 13.
  - **Packs communautaires fournis** : `Tile World Intro` et `CCLP 1` à `CCLP 5` (voir [Crédits](#crédits)).
  - **Formats `.DAT` / `.CCL` / `.JSON`** : import et export par glisser-déposer de packs au format binaire CC1 `.DAT`, très répandu. Les packs que vous possédez s'importent de cette façon. Un fichier de plus de `import.maxFileBytes` (4 Mio) est refusé avant d'être lu. À l'export, un niveau plus petit que le format 32x32 est fermé par des murs, et un niveau qui n'y tient pas est écarté avec un message au lieu d'être écrit faux.
  - **Niveaux de toute taille** : un niveau `.json` ou un pack personnalisé fixe sa propre largeur et sa propre hauteur, de la pièce de 10x10 au niveau de 40x40 ou 100x100 (`grid.minLevelSize` à `grid.maxLevelSize` dans `game.json`) ; la caméra, le radar et l'éditeur suivent le niveau. Le format `.DAT` et le générateur procédural gardent le 32x32 classique (`grid.mapWidth` / `grid.mapHeight`).
  - **Générateur procédural prouvé** : assemble les niveaux à partir de pièces d'énigme dessinées à la main (`public/configs/motifs.json`), chacune prouvée équitable et solvable par un solveur qui fait tourner le vrai moteur du jeu. Chaque niveau généré est ensuite rejoué du début à la fin avant d'être proposé : il est toujours solvable et aucune énigme ne peut être contournée. Difficulté, thème et rythme progressent avec le numéro du niveau. À partir du niveau 3, les niveaux sont des hubs aux ailes verrouillées dont les clés et les bottes se trouvent dans d'autres ailes ; la forme du hub (`procedural.hub.shapes` dans `game.json`) et les salles récompense varient, et avec le biome sur Auto chaque niveau prend l'ambiance de sa mécanique principale. Les niveaux sont disposés de façon compacte, avec peu de culs-de-sac, et deux niveaux voisins d'un pack ne partagent ni leur mécanique principale ni la forme de leur hub. Chaque pack vient d'une graine : **Générer Puzzle Infini** (ou `N`) en demande une (vide pour une graine aléatoire) ainsi que le niveau de départ, et la graine du pack en cours s'affiche à côté du sélecteur de pack avec un bouton Copier.
  - **Mode infini** : vise dès son premier niveau la difficulté des packs communautaires. Le niveau 1 est déjà un hub chronométré de 6 pièces difficiles (jusqu'au palier 5), qui monte à 10 pièces et 6 mécaniques (`procedural.endless` dans `game.json`). Seul le niveau joué est construit ; le suivant est préparé à l'avance dans un Web Worker, et la boîte de dialogue retient la graine et le niveau le plus loin atteint pour reprendre une partie. Le pack ne se termine jamais ; une partie peut commencer à n'importe quel niveau jusqu'à `endlessUi.maxStartLevel` (10000), et `src/generator/EndlessFingerprint.test.ts` vérifie qu'une graine construit toujours les mêmes niveaux. Les ailes d'un hub peuvent être des chaînes d'énigmes qui reviennent au hub par une bande de sol directionnel à sens unique (`hub.returnGate`), ce qui permet des pièces irréversibles et supprime le chemin de retour à pied. Les clés sont rares (`hub.scarceGates`) : une couleur de porte peut garder deux ailes alors qu'une seule clé est accessible au départ, donc l'ordre d'ouverture des ailes compte et la mauvaise porte oblige à recommencer le niveau. Les monstres sont présents dans la plupart des niveaux (`procedural.endless.motifShares`). La zone ouverte du hub est du contenu, pas du sol nu : 1 à 3 monstres qui suivent des lignes fixes (`hub.openMonsters`), 3 à 8 puces dispersées comme points de passage, une de plus par tranche de cellules de la zone (`hub.openChips`) et des taches de feu ou d'eau (`hub.openHazards`), avec des bandes de gravier qui tiennent les monstres hors des ailes ; le prouveur parcourt cette zone par une recherche temporisée. La zone grandit avec la surface que les énigmes laissent libre : le contour du hub gagne des rangées et des colonnes de sol avant le placement des ailes (`hub.outlineGrowth`), donc un niveau aux énigmes moins nombreuses ou plus petites a un hub plus grand ; la recherche de zone du prouveur vise sa cible au meilleur d'abord, donc le coût de la preuve suit le chemin et non le sol ; `npm run report:hub` mesure où va la surface de la carte. Des règles de densité gardent les énigmes équitables : `minBoxCellsPerMonster` donne de la place à chaque monstre et `maxMonstersPerLevel` plafonne le niveau. Les énigmes dépendent les unes des autres (`hub.dependencies`) : une pièce exporte un bloc de terre poussé hors de sa sortie, que l'on pousse le long d'un couloir rectiligne jusqu'à la pièce suivante, où il comble l'eau qui la verrouille ; ou une pièce exporte une clé que seule une porte d'une autre aile accepte, ce qui impose l'ordre de visite des ailes. Les paires sont déclarées dans les pièces elles-mêmes (`exports` et `imports` dans `motifs.json`), appariées par le planificateur de hub dans les hubs à ailes en boucle uniquement, et le niveau entier est rejoué avec le bloc poussé et la clé portée. La bibliothèque compte 91 pièces, dont des arènes de monstres, des réseaux de téléporteurs, des séquences de murs à bascule, des machines à cloner, et les pièces exportatrices et consommatrices de ces paires. `npm run report:levels` mesure ce mode face aux packs communautaires, `npm run report:dependencies` mesure la part des niveaux qui tiennent une paire de dépendance, et `src/generator/EndlessGuard.test.ts` maintient sa largeur, ses embranchements, ses retours en arrière, la présence de monstres, la part du sol ouvert proche d'un contenu, le nombre de pièces et le temps de génération au-dessus de seuils fixés. Dans les énigmes de blocs, le bouton Aide joue la poussée suivante, et le jeu signale une impasse dès qu'elle est prouvée (budgets de recherche sous `blockPuzzle` dans `game.json` : un petit pour la surveillance automatique, un plus grand pour le bouton Aide).
  - **Voir la solution** (`O`) : chaque niveau de la campagne et chaque niveau généré conserve la solution rejouée par sa preuve. Le bouton recommence le niveau et joue cette solution jusqu'à la sortie ; la regarder n'enregistre aucun score.
- **Moteur complet de tuiles et de monstres** :
  - Dangers élémentaires (`water`, `fire`, `ice` avec déflecteurs d'angle, convoyeurs `force` qui emportent le joueur, les blocs et les monstres, `bomb`).
  - Mécanismes interactifs (`button_green`, machines à cloner `button_red`, pièges `button_brown`, inverseurs de tanks `button_blue`, téléporteurs `teleport`, `thief`).
  - Dépôt d'objets : `E` pose la clé ou les bottes sélectionnées sur la case courante, `C` sélectionne l'objet suivant, et un clic sur une case de l'inventaire dépose cet objet. Le ramassage n'a lieu qu'en entrant sur une case : un objet déposé y reste jusqu'à ce que vous reveniez le chercher.
  - Barrières à objet interdit (`forbid_key_red`, `forbid_boots_fire`, ...) : la case vous refuse tant que vous portez l'objet, et redevient du sol une fois l'objet déposé ailleurs. Un voleur de clés (`thief_keys`) prend toutes les clés, comme le voleur d'équipement prend les bottes.
  - Les tortues (`turtle`) coulent dans l'eau une fois que le joueur ou un bloc les a quittées : un pont de tortues ne se traverse qu'une fois.
  - Les quinze combinaisons de parois fines (`thin_wall_ns`, `thin_wall_nesw`, ...), des téléporteurs de couleur qui ne s'enchaînent qu'avec leur propre couleur (`teleport_red` à `teleport_green`), des jets de flammes commandés par `button_orange` (`flame_jet_off` / `flame_jet_on`, les bottes ignifugées protègent), et des objets bonus : fanions de score (`score_10`, `score_100`, `score_1000` s'ajoutent au score du niveau payé à la sortie ; `score_2x` double ce score de niveau, fanions compris) et chronomètres (`stopwatch_bonus` ajoute 10 secondes, `stopwatch_penalty` en retire 10). Les bottes qui vous protègent sur votre case courante ne peuvent pas y être déposées.
  - 9 comportements de créatures (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Rendu et commandes** :
  - Moteurs de rendu HD Neon et Retro 16 bits avec 4 thèmes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`) : les murs se raccordent en masses continues qui projettent des ombres douces, les sources de lumière éclairent la scène en HD Neon, une grille LCD optionnelle couvre le Retro 16 bits, et le joueur comme chaque monstre sont animés. Un réglage de qualité graphique (Auto par défaut) garde le jeu fluide sur les appareils plus lents.
  - Localisateur d'objectif et affichage des câblages de mécanismes (`H`) ; survoler un téléporteur de couleur montre son propre réseau, et survoler un bouton orange montre les jets de flammes qu'il commande.
  - Glyphes pour daltoniens sur les portes, clés, boutons et téléporteurs de couleur.
  - Mouvement réduit : quand le réglage système est actif, le saut, le flottement, les reflets, le scintillement, les clignotements, les particules et la secousse d'écran s'arrêtent, et un changement du réglage est suivi en direct.
  - Clavier : `Tab` déplace le focus entre les commandes, les raccourcis Ctrl/Cmd sont laissés au navigateur sauf l'annulation (Ctrl/Cmd+Z), qui suit la disposition du clavier (AZERTY, QWERTY, cyrillique...), et `?` ouvre l'aide.
  - Support tactile complet sur smartphone (joystick virtuel par glissement, déplacement par toucher, zoom à deux doigts, croix directionnelle avec retour haptique).
  - Éditeur de niveaux complet avec validation en direct par le solveur.

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

Un niveau `.json` est un plan : `terrain` (une grille d'identifiants de tuiles) ou `rows` (des chaînes de légende, voir `legend` dans `levels.json`) donne sa taille au niveau, donc des lignes de 40 caractères font un niveau de 40 de large ; un plan sans l'un ni l'autre prend le 32x32 par défaut. Le départ du joueur, les entités et les liens doivent se trouver dans cette taille.

La difficulté du générateur découle d'un profil (`src/generator/DifficultyProfile.ts`) : `profileFor('pack' | 'endless', levelNumber, cfg)` donne le nombre de pièces, le nombre de mécaniques, le palier maximal, la disposition, le chronomètre et la longueur visée. Les packs suivent la courbe d'apprentissage de `procedural` ; le mode infini suit `procedural.endless`. La campagne scénarisée et le mode pack ne changent pas avec le mode infini.

La campagne Epoxy elle-même est décrite niveau par niveau dans `tools/campaign-script.json` (motifs à enseigner, nombre d'énigmes, palier maximal) ; `npm run build:campaign` génère chaque niveau, le prouve et réécrit `public/configs/levels.json` en lignes de légende lisibles.

Les nouvelles pièces d'énigme se placent dans `public/configs/motifs.json` ; lancez ensuite `npm run annotate:pieces` pour précalculer la solution et la réversibilité de chaque pièce dans `public/configs/motif-annotations.json`, que le générateur lit au lieu de chercher dans le navigateur.

Salles Sokoban : `npm run forge:sokoban` en fabrique d'originales en partant de leur solution (des blocs sur des boutons marron qui maintiennent ouverts les pièges de sortie). `npm run import:sokoban` adapte une collection au format standard `.xsb` (renseignez `EPOXY_SOKOBAN_FILE` et `EPOXY_SOKOBAN_CREDIT`) ; n'utilisez que des collections dont la licence autorise la réutilisation, et conservez le crédit. Les deux écrivent des candidates dans `local/` pour le tri. `npm test` vérifie que chacune est solvable dans toutes les orientations, qu'aucun bloc ne peut sortir par ses ports et que rien n'y est décoratif ; `npm run report:pieces` écrit la solution de chaque pièce dans `local/piece-probe.txt`.

## Tests

```bash
npm test
```

La suite comprend `src/test/typographyGuard.test.ts`, qui parcourt chaque fichier texte suivi à la recherche de caractères typographiques interdits (tirets longs, guillemets courbes, points de suspension en un caractère, espaces insécables, ligatures).

`npm run report:levels` mesure 200 niveaux générés en les comparant aux packs communautaires fournis, et écrit `reports/level-metrics.json`, avec des mesures de l'espace jouable : remplissage (cases ouvertes rapportées à leur rectangle englobant), part de cases ouvertes, culs-de-sac, carrefours, symétrie et présence de monstres. `npm run report:study` décrit comment les packs communautaires combinent les mécaniques, et `npm run mine:pieces` cherche des pièces d'énigme plus difficiles (environ une demi-heure) ; les deux écrivent dans `local/`.

## Build de production

```bash
npm run build
```

## Crédits

Les packs `CCLP 1` à `CCLP 5` fournis sont des jeux de niveaux créés par la communauté, et `Tile World Intro` est distribué avec le projet Tile World. Tous les niveaux de ces packs restent l'oeuvre de leurs auteurs respectifs. Epoxy n'est affilié à aucun détenteur de jeu commercial.

## Licence

Copyright 2026 Julien Bombled. Le code source d'Epoxy est publié sous [licence Apache 2.0](./LICENSE). Les packs de niveaux fournis ne sont pas couverts par cette licence.
