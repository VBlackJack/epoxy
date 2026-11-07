*English version: [../puzzle-encyclopedia.md](../puzzle-encyclopedia.md)*

# Encyclopédie des énigmes et mécanismes de sanctuaire

Cette encyclopédie recense les **14 archétypes canoniques d'énigmes de sanctuaire** répartis en 5 familles mécaniques, avec leurs plans ASCII, leurs invariants de conception, leurs pièges d'impasse et leurs règles de composition pour construire des niveaux dans Epoxy.

Chaque plan d'archétype documenté ici est vérifié automatiquement dans `public/configs/excavation-encyclopedia.json` (`src/config/ExcavationEncyclopedia.test.ts`) : chaque salle compile sans erreur, passe `LevelValidator.validate` avec zéro anomalie et rejoue sa solution la plus courte jusqu'à la victoire dans `GameEngine`.

---

## 1. Vue d'ensemble de la taxonomie

| ID | Archétype | Famille | Palier | Mécanismes clés |
|---|---|---|---|---|
| `boulder_sluice` | Écluse à rocher unique | `sluice` | 1 | `dirt_block`, `water`, `dirt`, `socket` |
| `double_sluice` | Double écluse séquentielle | `sluice` | 2 | `dirt_block`, `water`, `dirt`, `socket` |
| `elemental_alchemy` | Écluse alchimique feu-eau | `sluice` | 3 | `ice_block`, `dirt_block`, `fire`, `water`, `dirt` |
| `counterweight_hold` | Dalle de maintien à contrepoids | `extraction` | 1 | `dirt_block`, `pressure_plate_red`, `hold_door_red_closed` |
| `grappling_alcove` | Extraction d'alcôve au grappin | `extraction` | 2 | `boots_pull`, `dirt_block`, `pressure_plate_blue`, `hold_door_blue_closed` |
| `counterweight_swap` | Échange pont et contrepoids | `extraction` | 3 | `boots_pull`, `dirt_block`, `water`, `pressure_plate_blue`, `hold_door_blue_closed` |
| `prism_slalom` | Slalom laser multi-prismes | `optics` | 2 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_gate_red_closed` |
| `grappling_prism` | Prisme d'alcôve au grappin | `optics` | 3 | `boots_pull`, `mirror_backslash`, `laser_emitter_s`, `laser_receiver_red`, `laser_gate_red_closed` |
| `crossed_beams` | Matrice à double faisceau croisé | `optics` | 4 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_receiver_blue`, `laser_gate_red_closed`, `laser_gate_blue_closed` |
| `glacier_slide` | Glissade sur glacier et déflecteur d'angle | `kinetic` | 2 | `dirt_block`, `ice`, `ice_ne`, `pressure_plate_yellow`, `hold_door_yellow_closed` |
| `conveyor_sluice` | Convoyeur d'écluse à courant | `kinetic` | 3 | `dirt_block`, `force_e`, `pressure_plate_green`, `hold_door_green_closed` |
| `clone_foundry` | Fonderie de clonage de rochers | `kinetic` | 4 | `button_red`, `clone_machine`, `dirt_block`, `water`, `dirt` |
| `portal_islands` | Transbordeur téléporteur multi-îles | `network` | 3 | `dirt_block`, `teleport_red`, `teleport_blue`, `pressure_plate_red`, `hold_door_red_closed` |
| `signal_relay` | Relais logique à double chambre | `network` | 5 | `signal_plate`, `laser_receiver_red`, `signal_gate_and`, `hold_door_red_closed`, `dirt_block`, `mirror_backslash` |

---

## 2. Invariants globaux de conception de niveaux

Avant d'assembler des mécanismes issus de cette encyclopédie, respectez ces quatre invariants du moteur afin que `LevelValidator` ne signale aucun avertissement ni erreur :

1. **Aucun contournement de verrou (`socket_bypass`)** : dès qu'un niveau comporte au moins un bloc poussable et `chipsRequired > 0`, `LevelValidator` considère l'eau (`water`) et le feu (`fire`) comme franchissables. Placez toujours un `socket` (`S`) ou une porte fermée (`hold_door_*_closed`, `laser_gate_*_closed`) sur le goulet final devant la sortie (`E`), et fermez les murs latéraux pour empêcher tout contournement.
2. **Aucun objet ou indice recouvert par un bloc (`hidden_by_block`)** : `LevelValidator` calcule toutes les cases qu'un bloc peut atteindre. Ne placez jamais une puce (`C`), une clé (`key_*`), une paire de bottes (`boots_*`) ou un indice (`H`) sur une case accessible à un bloc. Protégez-les en les plaçant :
   - dans une **alcôve à trois murs** (la case derrière l'objet étant un mur `#`, aucun pousseur ne peut se placer derrière le bloc pour l'y pousser), ou
   - derrière une **case de terre (`d`)**, car la terre bloque les entités (`passableByBlock: false`) tant que le joueur n'a pas marché dessus.
3. **Case de dégagement perpendiculaire pour le grappin (`boots_pull`)** : lorsque le joueur porte `boots_pull`, reculer d'une case adjacente à un bloc tire ce bloc sur l'ancienne case du joueur. Tout couloir de traction d'une case de large doit déboucher sur une poche de 2 cases ou un carrefour en T permettant un **pas de côté perpendiculaire** afin de détacher le bloc avant de le contourner.
4. **Butées de faisceau laser et retour sûr** : un faisceau laser actif est mortel pour le joueur. Placez toujours un mur `#` de butée derrière la case cible d'un miroir et positionnez les miroirs mobiles une case en dehors de la ligne de tir initiale afin de les pousser dans le faisceau sans jamais marcher sur le rayon.

---

## 3. Famille 1 : Ingénierie hydraulique et écluses (`sluice`)

### 3.1 Écluse à rocher unique (`boulder_sluice`, Palier 1)
Poussez un rocher (`dirt_block`) dans un canal d'eau d'une case (`W`) pour le transformer en terre (`d`), puis marchez sur la motte de terre pour la compacter en sol ordinaire.

```text
#########
#P......#
#..$....#
###W#####
###d..C##
###...SE#
#########
```

- **Solution vérifiée** : `EESSSEEESE` (10 pas)
- **Invariants** :
  - Laissez une case de sol libre au nord de `$` pour aligner la poussée sur la colonne 3.
  - Fermez `(7, 4)` par un mur `#` pour imposer le passage par `S(6, 5)` avant `E(7, 5)`.
- **Pièges d'impasse** : pousser `$` vers l'ouest ou l'est contre un mur périphérique bloque le rocher.

### 3.2 Double écluse séquentielle (`double_sluice`, Palier 2)
Comblez un canal d'eau de deux cases (`WW`) à l'aide de deux rochers. Comme le premier rocher transforme la première case `W` en terre (`d`) et que la terre bloque les entités, le joueur doit d'abord marcher sur la première case comblée pour la compacter en `.` avant de revenir pousser le second rocher.

```text
#########
#P......#
#..$..$.#
#.......#
###W#####
###W#####
###d..C##
###...SE#
#########
```

- **Solution vérifiée** : `EESSSNEEEENWWWNWSSSSSEEESE` (26 pas)
- **Invariants** : prévoyez une salle de manoeuvre de 3 lignes (`lignes 1-3`) pour amener le second rocher de `(6, 2)` jusqu'en `(3, 2)`.
- **Pièges d'impasse** : pousser le second rocher dans la colonne 3 avant d'avoir compacté `d(3, 4)` bloque l'entrée du canal.

### 3.3 Écluse alchimique feu-eau (`elemental_alchemy`, Palier 3)
Réaction alchimique en deux temps : poussez un bloc de glace (`I`) dans le feu (`F`) pour transmuter les deux en eau (`W`), puis poussez un rocher (`$`) dans l'eau obtenue afin de créer un pont de terre (`d`).

```text
#########
#P......#
#..I..$.#
###.#####
###F#####
###d..C##
###...SE#
#########
```

- **Solution vérifiée** : `EESSNNEEEESWWWNWSSSSEEESE` (25 pas)
- **Invariants** : placez `I` (`ice_block`) dans l'axe du goulet `F` afin que le joueur éteigne d'abord le brasier avant d'amener `$` (`dirt_block`).

---

## 4. Famille 2 : Contrepoids et extraction d'alcôve (`extraction`)

### 4.1 Dalle de maintien à contrepoids (`counterweight_hold`, Palier 1)
Poussez un rocher (`$`) sur une dalle `pressure_plate_red` (`[`) pour maintenir ouverte la porte `hold_door_red_closed` (`]`).

```text
#########
#P......#
#..$..[.#
#.......#
###]#####
###C..SE#
#########
```

- **Solution vérifiée** : `ESEEESWWSSEEEE` (14 pas)
- **Invariants** : une porte `hold_door_<couleur>_closed` ne s'ouvre que lorsque **toutes** les dalles `pressure_plate_<couleur>` de cette couleur sont pressées.

### 4.2 Extraction d'alcôve au grappin (`grappling_alcove`, Palier 2)
Ramassez les gants grappin (`boots_pull`, `G`) dans leur alcôve, tirez le rocher encastré (`$`) hors de son alcôve en `(2, 3)` vers l'est jusqu'en `(5, 3)`, faites un pas au nord en `(6, 2)` pour vous dégager sans retirer le rocher, puis passez en `(5, 2)` pour pousser `$` au sud sur la dalle `[`.

```text
#########
#P....#G#
#.###...#
##$.....#
###d#[###
###]#####
###C..SE#
#########
```

- **Solution vérifiée** : `EEEESEENSSWWWWEEENWSWWSSSEEEE` (29 pas)
- **Invariants** :
  - `G` (`boots_pull`) est logé dans une alcôve à 3 murs en `(7, 1)` hors de portée du rocher.
  - La case `d` en `(3, 4)` empêche le rocher d'entrer dans le couloir de la porte tout en laissant passer le joueur.

### 4.3 Échange pont et contrepoids (`counterweight_swap`, Palier 3)
Sacrifiez le rocher supérieur (`$`) pour combler les douves `W(3, 3)`, puis utilisez `boots_pull` (`G`) pour extraire le second rocher encastré en `(2, 4)` et le pousser sur la dalle `[`.

```text
#########
#P.d.G###
#..$#####
###W#...#
##$.....#
###d#[###
###]#####
###C..SE#
#########
```

- **Solution vérifiée** : `EEEEWWSSSEEENWSWWSSSEEEE` (24 pas)
- **Invariants** : la case `d` en `(3, 1)` isole `G(5, 1)` du rocher supérieur et élimine tout avertissement `hidden_by_block`.

---

## 5. Famille 3 : Optique prismatique (`optics`)

### 5.1 Slalom laser multi-prismes (`prism_slalom`, Palier 2)
Déviez le faisceau d'un émetteur `laser_emitter_e` (`>`) autour d'un pilier central à l'aide de deux prismes `mirror_backslash` (`\`) vers `laser_receiver_red` (`R`), ouvrant `laser_gate_red_closed` (`:`).

```text
#########
#P...d:C#
#...\.#S#
#>...##E#
#.....###
#..\..R.#
#########
```

- **Solution vérifiée** : `EEEESWNWSNEEEESS` (16 pas)
- **Invariants** : placez le miroir supérieur en `(4, 2)` au nord du faisceau afin de le pousser vers le sud en `(4, 3)` tout en restant dans le couloir supérieur sécurisé.

### 5.2 Prisme d'alcôve au grappin (`grappling_prism`, Palier 3)
Récupérez `boots_pull` (`G`), tirez le miroir `mirror_backslash` (`\`) hors de son alcôve en `(2, 3)`, dégagez-vous par le nord en `(5, 2)`, contournez le miroir par `(3, 2) -> (3, 3)`, puis poussez-le vers l'est dans le faisceau de `laser_emitter_s` (`v`) en `(6, 3)` afin d'illuminer `R(7, 3)`.

```text
#########
#P....dG#
#.#...v##
##\....R#
###d#####
###:#####
###C..SE#
#########
```

- **Solution vérifiée** : `EEEEEEWWSSWWEENWWSEENWSWSSSEEEE` (31 pas)
- **Invariants** : comme le miroir est poussé depuis `(5, 3)` vers `(6, 3)`, le joueur ne marche jamais sur la case du rayon `(6, 3)`.

### 5.3 Matrice à double faisceau croisé (`crossed_beams`, Palier 4)
Deux émetteurs horizontaux sur les lignes 3 et 4 croisent leurs rayons via deux prismes `mirror_backslash` (`\`) pour illuminer `laser_receiver_red` (`R`) et `laser_receiver_blue` (`B`), ouvrant le double sas `:` + `;`.

```text
#########
#P...d:;#
#..\.\#C#
#>....#S#
#>....#E#
#..R.B###
#########
```

- **Solution vérifiée** : `EESNEESSNNEESSS` (15 pas)
- **Invariants** : les deux miroirs démarrent en ligne 2 (au nord des faisceaux) afin que le joueur les pousse vers le sud tout en restant dans le couloir supérieur sécurisé.

---

## 6. Famille 4 : Routage cinétique et cryogénique (`kinetic`)

### 6.1 Glissade sur glacier et déflecteur d'angle (`glacier_slide`, Palier 2)
Poussez un rocher (`$`) vers l'est sur une piste de glace (`I`) terminée par un mur d'angle `ice_ne` (`2`) afin qu'il bifurque vers le sud jusque sur la dalle `pressure_plate_yellow` (`[`), ouvrant `hold_door_yellow_closed` (`]`).

```text
#########
#P......#
#.$II2..#
#....I..#
###]#[###
###d.#SE#
###C...##
#########
```

- **Solution vérifiée** : `SESESSSEEEENE` (13 pas)
- **Invariants** : le mur `#` en `(5, 5)` juste au sud de la dalle `[` arrête le rocher sur la dalle et empêche le joueur de glisser dans la salle inférieure sans le rocher.

### 6.2 Convoyeur d'écluse à courant (`conveyor_sluice`, Palier 3)
Poussez un rocher (`$`) vers l'est sur un tapis `force_e` (`>`) afin que le courant l'entraîne sur `pressure_plate_green` (`[`), ouvrant `hold_door_green_closed` (`]`).

```text
#########
#P......#
#.$>>>[.#
#.......#
###]#####
###C..SE#
#########
```

- **Solution vérifiée** : `SESESSEEEE` (10 pas)
- **Invariants** : le courant s'achève directement sur la dalle `[` en `(6, 2)`.

### 6.3 Fonderie de clonage de rochers (`clone_foundry`, Palier 4)
Marchez sur `button_red` (`+`) relié par `cloneLinks` à une `clone_machine` (`M`) portant un modèle `dirt_block` orienté vers l'est, puis poussez le rocher engendré en `(3, 2)` vers le sud dans `W(3, 3)`.

```text
#########
#P+.....#
#.M.....#
###W#####
###d..C##
###...SE#
#########
```

- **Solution vérifiée** : `EESSSEEESE` (10 pas)
- **Invariants** : l'orientation `templateDir: "E"` fait apparaître le rocher en `(3, 2)` avec la case `(3, 1)` libre au nord pour permettre au joueur de le pousser vers le sud.

---

## 7. Famille 5 : Sanctuaires de réseaux et logique (`network`)

### 7.1 Transbordeur téléporteur multi-îles (`portal_islands`, Palier 3)
Poussez un rocher (`$`) vers le sud dans `teleport_red` (`O`) en `(3, 3)` pour qu'il ressorte du `teleport_red` inférieur en `(3, 5)` vers le sud sur `pressure_plate_red` (`[`) en `(3, 6)`, puis empruntez `teleport_blue` (`o`) en `(6, 2) -> (6, 5)` et franchissez `hold_door_red_closed` (`]`).

```text
#########
#P......#
#..$..o.#
#..O....#
#########
#..O.#o.#
#..[###]#
####ESC.#
#########
```

- **Solution vérifiée** : `EESEEESSWWW` (11 pas)
- **Invariants** : entourez le téléporteur d'arrivée du joueur `o(6, 5)` de murs afin qu'il ne puisse rejoindre le couloir inférieur qu'en franchissant `](7, 6)`.

### 7.2 Relais logique à double chambre (`signal_relay`, Palier 5)
Poussez `$` sur la dalle `signal_plate` (`!`) en `(4, 1)` ET poussez le miroir `\` dans le faisceau laser de la ligne 3 afin d'illuminer `laser_receiver_red` (`R`) en `(4, 4)`. Ces deux entrées alimentent la porte logique `signal_gate_and` (`&`) en `(2, 5)`, dont la sortie commande `hold_door_red_closed` (`]`) en `(7, 1)`.

```text
#########
#P$.!..]#
#...\.#C#
#>....#S#
#...R.#E#
##&######
#########
```

- **Solution vérifiée** : `SEENESWWWNEESEENEESSS` (21 pas)
- **Câblage logique (`signalLinks`)** :
  - `(4, 1) -> (2, 5)` (`signal_plate` vers `signal_gate_and`)
  - `(4, 4) -> (2, 5)` (`laser_receiver_red` vers `signal_gate_and`)
  - `(2, 5) -> (7, 1)` (`signal_gate_and` vers `hold_door_red_closed`)

---

## 8. Composition et chaînage de sanctuaires multi-salles

Pour construire un niveau de sanctuaire complet (15x15 à 25x25) en chaînant les archétypes de cette encyclopédie :

1. **Architecture en moyeu et ailes (Hub-and-Wings)** : placez un hall central abritant la porte finale du sanctuaire (`hold_door_*_closed`, `laser_gate_*_closed` ou `socket` + `exit`), entouré de 2 à 4 ailes contenant chacune un archétype (`boulder_sluice`, `grappling_alcove`, `prism_slalom`, `elemental_alchemy`).
2. **Progression par outil** : placez `boots_pull` ("Gants grappin") comme récompense d'une première aile (`boulder_sluice` ou `prism_slalom`), ce qui déverrouille les rochers et prismes encastrés dans les ailes suivantes (`grappling_alcove`, `counterweight_swap`, `grappling_prism`).
3. **Dépendances inter-ailes** :
   - **Transbordement de rocher** : extrayez un rocher d'une aile `grappling_alcove` ou `clone_foundry` et acheminez-le via `portal_islands` ou `conveyor_sluice` vers une `double_sluice`.
   - **Double verrouillage final** : câblez deux ailes (une aile `signal_plate` à contrepoids et une aile `laser_receiver_*` à prisme) sur une porte `signal_gate_and` (`signal_relay`) commandant l'accès au sanctuaire central.
