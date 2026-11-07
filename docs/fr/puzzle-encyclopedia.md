*English version: [../puzzle-encyclopedia.md](../puzzle-encyclopedia.md)*

# Encyclopédie des énigmes et mécanismes de sanctuaire

Cette encyclopédie recense les **25 archétypes canoniques d'énigmes de sanctuaire** répartis en 9 familles mécaniques, avec leurs plans ASCII, leurs invariants de conception, leurs pièges d'impasse et leurs règles de composition pour construire des niveaux dans Epoxy.

Chaque plan d'archétype documenté ici est vérifié automatiquement dans `public/configs/excavation-encyclopedia.json` (`src/config/ExcavationEncyclopedia.test.ts`) : chaque salle compile sans erreur, passe `LevelValidator.validate` avec zéro anomalie, rejoue sa solution la plus courte jusqu'à la victoire dans `GameEngine` et prouve qu'aucune entité, liaison ou objet d'énigme ne peut être contourné.

---

## 1. Vue d'ensemble de la taxonomie

| ID | Archétype | Famille | Palier | Mécanismes clés |
|---|---|---|---|---|
| `boulder_sluice` | Écluse à rocher unique | `sluice` | 1 | `dirt_block`, `water`, `dirt`, `socket` |
| `double_sluice` | Double écluse séquentielle | `sluice` | 2 | `dirt_block`, `water`, `dirt`, `socket` |
| `elemental_alchemy` | Écluse alchimique feu-eau | `sluice` | 3 | `ice_block`, `dirt_block`, `fire`, `water`, `dirt`, `socket` |
| `counterweight_hold` | Dalle de maintien à contrepoids | `extraction` | 1 | `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `grappling_alcove` | Extraction d'alcôve au grappin | `extraction` | 2 | `boots_pull`, `dirt_block`, `pressure_plate_blue`, `hold_door_blue_closed`, `dirt`, `socket` |
| `counterweight_swap` | Échange pont et contrepoids | `extraction` | 3 | `boots_pull`, `dirt_block`, `water`, `dirt`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket` |
| `prism_slalom` | Slalom laser multi-prismes | `optics` | 2 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `grappling_prism` | Prisme d'alcôve au grappin | `optics` | 3 | `boots_pull`, `mirror_backslash`, `laser_emitter_s`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `crossed_beams` | Matrice à double faisceau croisé | `optics` | 4 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_receiver_blue`, `laser_gate_red_closed`, `laser_gate_blue_closed`, `dirt`, `socket` |
| `glacier_slide` | Glissade sur glacier et déflecteur d'angle | `kinetic` | 2 | `dirt_block`, `ice`, `ice_ne`, `pressure_plate_yellow`, `hold_door_yellow_closed`, `socket` |
| `conveyor_sluice` | Convoyeur d'écluse à courant | `kinetic` | 3 | `dirt_block`, `force_e`, `pressure_plate_green`, `hold_door_green_closed`, `socket` |
| `clone_foundry` | Fonderie de clonage de rochers | `kinetic` | 4 | `button_red`, `clone_machine`, `dirt_block`, `water`, `dirt`, `socket` |
| `portal_islands` | Transbordeur téléporteur multi-îles | `network` | 3 | `dirt_block`, `teleport_red`, `teleport_blue`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `signal_relay` | Relais logique à double chambre | `network` | 5 | `signal_plate`, `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `signal_gate_and`, `hold_door_red_closed`, `dirt_block`, `dirt`, `socket` |
| `monster_clock` | Horloge à échappement de balle rose | `automata` | 2 | `pink_ball`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `trap_escapement` | Échappement à piège de relâchement | `automata` | 3 | `button_brown`, `trap`, `tank`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `tank_convoy` | Convoi de char à bouton bleu | `automata` | 4 | `button_blue`, `tank`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket` |
| `rail_switchyard` | Triage d'aiguillage ferroviaire | `transit` | 3 | `button_green`, `button_brown`, `trap`, `tank`, `rail_ns`, `rail_switch_b`, `rail_ew`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `turning_force_distributor` | Distributeur à tapis tournant | `transit` | 3 | `force_cycle`, `dirt_block`, `pressure_plate_green`, `hold_door_green_closed`, `socket` |
| `pocket_gate_shuttle` | Navette à porte de poche portative | `transit` | 4 | `pocket_gate`, `pocket_gate_pad`, `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `dirt`, `socket` |
| `blast_charge_breach` | Brèche par charge explosive temporisée | `ballistics` | 3 | `charge`, `dirt_block`, `force_s`, `button_green`, `toggle_wall_closed`, `laser_emitter_e`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `hurl_stone_ricochet` | Pierre de jet à ricochet sur miroir | `ballistics` | 3 | `hurl_stone`, `mirror_backslash`, `water`, `bomb`, `force_e`, `dirt`, `socket` |
| `ward_lurker_gambit` | Gambit d'égide et de guetteur endormi | `ballistics` | 4 | `ward`, `lurker_dormant`, `thin_wall_e`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `toggle_parity_weave` | Tissage de parité à double canal | `parity` | 3 | `button_green`, `toggle_button_red`, `toggle_wall_closed`, `toggle_wall_red_closed`, `dirt_block`, `water`, `dirt`, `socket` |
| `thief_boot_toll` | Écluse à bottes de feu et péage du voleur | `parity` | 3 | `boots_fire`, `fire`, `dirt_block`, `water`, `thief`, `forbid_boots_fire`, `dirt`, `socket` |

---

## 2. Invariants globaux de conception de niveaux

Avant d'assembler des mécanismes issus de cette encyclopédie, respectez ces quatre invariants du moteur afin que `LevelValidator` ne signale aucun avertissement ni erreur :

1. **Aucun contournement de verrou (`socket_bypass`)** : dès qu'un niveau comporte au moins un bloc poussable et `chipsRequired > 0`, `LevelValidator` considère l'eau (`water`) et le feu (`fire`) comme franchissables. Placez toujours un `socket` (`S`) ou une porte fermée (`hold_door_*_closed`, `laser_gate_*_closed`) sur le goulet final devant la sortie (`E`), et fermez les murs latéraux pour empêcher tout contournement.
2. **Aucun objet ou indice recouvert par un bloc (`hidden_by_block`)** : `LevelValidator` calcule toutes les cases qu'un bloc peut atteindre. Ne placez jamais une puce (`C`), une clé (`key_*`), une paire de bottes (`boots_*`), `pocket_gate`, `hurl_stone`, `charge`, `ward` ou un indice (`H`) sur une case accessible à un bloc. Protégez-les en les plaçant :
   - dans une **alcôve à trois murs** (la case derrière l'objet étant un mur `#`, aucun pousseur ne peut se placer derrière le bloc pour l'y pousser), ou
   - derrière une **case de terre (`d`)**, car la terre bloque les entités (`passableByBlock: false`) tant que le joueur n'a pas marché dessus.
3. **Case de dégagement perpendiculaire pour le grappin (`boots_pull`)** : lorsque le joueur porte `boots_pull`, reculer d'une case adjacente à un bloc tire ce bloc sur l'ancienne case du joueur. Tout couloir de traction d'une case de large doit déboucher sur une poche de 2 cases ou un carrefour en T permettant un **pas de côté perpendiculaire** afin de détacher le bloc avant de le contourner.
4. **Butées de faisceau laser et retour sûr** : un faisceau laser actif est mortel pour le joueur. Placez toujours un mur `#` de butée derrière la case cible d'un miroir et positionnez les miroirs mobiles une case en dehors de la ligne de tir initiale afin de les pousser dans le faisceau sans jamais marcher sur le rayon.

---

## 3. Famille 1 : Ingénierie hydraulique et écluses (`sluice`)

Tranchées d'eau et de dangers élémentaires comblées par des rochers séquentiels, des blocs de glace et de la terre compactée.

### 3.1 Écluse à rocher unique (`boulder_sluice`, Palier 1)
Comblez un canal d'eau d'une case en poussant un rocher dans la tranchée puis en compactant la terre obtenue.

```text
#########
#P......#
#..$....#
###W#####
###d..C##
###...SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `W` = `water` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `water`, `dirt`, `socket`
- **Solution vérifiée** : `EESSSEEESE`

### 3.2 Double écluse séquentielle (`double_sluice`, Palier 2)
Comblez une tranchée d'eau de deux cases avec deux rochers en compactant la première motte de terre avant d'y pousser le second rocher.

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

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `W` = `water` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `water`, `dirt`, `socket`
- **Solution vérifiée** : `EESSSNEEEENWWWNWSSSSSEEESE`

### 3.3 Écluse alchimique feu-eau (`elemental_alchemy`, Palier 3)
Poussez un bloc de glace dans un brasier pour le transmuter en eau, puis comblez l'eau avec un rocher.

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

- **Légende** : `P` = `floor, départ : S` ; `I` = `floor, entité : ice_block` ; `$` = `floor, entité : dirt_block` ; `F` = `fire` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `ice_block`, `dirt_block`, `fire`, `water`, `dirt`, `socket`
- **Solution vérifiée** : `EESSNNEEEESWWWNWSSSSEEESE`

---

## 4. Famille 2 : Contrepoids et extraction d'alcôve (`extraction`)

Portes maintenues par dalles de pression, échanges de contrepoids et rochers encastrés extraits au grappin.

### 4.1 Dalle de maintien à contrepoids (`counterweight_hold`, Palier 1)
Stationnez un rocher sur une dalle de pression colorée pour maintenir ouverte la porte associée.

```text
#########
#P......#
#..$..[.#
#.......#
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `ESEEESWWSSEEEE`

### 4.2 Extraction d'alcôve au grappin (`grappling_alcove`, Palier 2)
Utilisez les gants grappin pour extraire un rocher d'une alcôve à trois murs, puis décalez-vous perpendiculairement avant de le pousser.

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

- **Légende** : `P` = `floor, départ : S` ; `G` = `floor, objet : boots_pull` ; `$` = `floor, entité : dirt_block` ; `d` = `dirt` ; `[` = `pressure_plate_blue` ; `]` = `hold_door_blue_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `boots_pull`, `dirt_block`, `pressure_plate_blue`, `hold_door_blue_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EEEESEENSSWWWWEEENWSWWSSSEEEE`

### 4.3 Échange pont et contrepoids (`counterweight_swap`, Palier 3)
Utilisez un premier rocher pour franchir les douves, puis extrayez un second rocher encastré avec le grappin pour lester la dalle.

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

- **Légende** : `P` = `floor, départ : S` ; `G` = `floor, objet : boots_pull` ; `$` = `floor, entité : dirt_block` ; `W` = `water` ; `d` = `dirt` ; `[` = `pressure_plate_blue` ; `]` = `hold_door_blue_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `boots_pull`, `dirt_block`, `water`, `dirt`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket`
- **Solution vérifiée** : `EEEEWWSSSEEENWSWWSSSEEEE`

---

## 5. Famille 3 : Optique prismatique (`optics`)

Émetteurs laser déviés autour de piliers et à travers des salles partagées via des miroirs diagonaux mobiles.

### 5.1 Slalom laser multi-prismes (`prism_slalom`, Palier 2)
Déviez un faisceau laser autour d'un pilier de pierre à l'aide de deux miroirs diagonaux mobiles pour illuminer un récepteur et ouvrir sa grille.

```text
#########
#P...d:C#
#...\.#S#
#>...##E#
#.....###
#..\..R.#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `>` = `laser_emitter_e` ; `\` = `floor, entité : mirror_backslash` ; `R` = `laser_receiver_red` ; `:` = `laser_gate_red_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EEEESWNWSNEEEESS`

### 5.2 Prisme d'alcôve au grappin (`grappling_prism`, Palier 3)
Extrayez un miroir diagonal d'une alcôve à trois murs avec le grappin, dégagez-vous par un pas de côté, puis poussez-le dans le faisceau laser.

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

- **Légende** : `P` = `floor, départ : S` ; `G` = `floor, objet : boots_pull` ; `v` = `laser_emitter_s` ; `\` = `floor, entité : mirror_backslash` ; `R` = `laser_receiver_red` ; `:` = `laser_gate_red_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `boots_pull`, `mirror_backslash`, `laser_emitter_s`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EEEEEEWWSSWWEENWWSEENWSWSSSEEEE`

### 5.3 Matrice à double faisceau croisé (`crossed_beams`, Palier 4)
Acheminez deux faisceaux laser orthogonaux à travers une salle commune vers des récepteurs rouge et bleu pour déverrouiller un double sas laser.

```text
#########
#P...d:;#
#..\.\#C#
#>....#S#
#>....#E#
#..R.B###
#########
```

- **Légende** : `P` = `floor, départ : S` ; `>` = `laser_emitter_e` ; `\` = `floor, entité : mirror_backslash` ; `R` = `laser_receiver_red` ; `B` = `laser_receiver_blue` ; `:` = `laser_gate_red_closed` ; `;` = `laser_gate_blue_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_receiver_blue`, `laser_gate_red_closed`, `laser_gate_blue_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EESNEESSNNEESSS`

---

## 6. Famille 4 : Routage cinétique et cryogénique (`kinetic`)

Glissades sur glace sans friction, déflecteurs d'angle, courants convoyeurs et fonderies de clonage.

### 6.1 Glissade sur glacier et déflecteur d'angle (`glacier_slide`, Palier 2)
Lancez un rocher sur de la glace sans friction vers un mur d'angle incurvé afin qu'il glisse jusque sur une dalle de pression distante.

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

- **Légende** : `2` = `ice_ne` ; `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `I` = `ice` ; `[` = `pressure_plate_yellow` ; `]` = `hold_door_yellow_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `ice`, `ice_ne`, `pressure_plate_yellow`, `hold_door_yellow_closed`, `socket`
- **Solution vérifiée** : `SESESSSEEEENE`

### 6.2 Convoyeur d'écluse à courant (`conveyor_sluice`, Palier 3)
Poussez un rocher sur un courant directionnel afin que le flux l'emporte vers une écluse ou une dalle distante.

```text
#########
#P......#
#.$>>>[.#
#.......#
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `>` = `force_e` ; `[` = `pressure_plate_green` ; `]` = `hold_door_green_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `force_e`, `pressure_plate_green`, `hold_door_green_closed`, `socket`
- **Solution vérifiée** : `SESESSEEEE`

### 6.3 Fonderie de clonage de rochers (`clone_foundry`, Palier 4)
Actionnez un bouton de clonage rouge pour produire des rochers depuis une machine de clonage et combler un canal d'eau.

```text
#########
#P+.....#
#.M.....#
###W#####
###d..C##
###...SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `+` = `button_red` ; `M` = `clone_machine, entité : dirt_block (E)` ; `W` = `water` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `button_red`, `clone_machine`, `dirt_block`, `water`, `dirt`, `socket`
- **Solution vérifiée** : `EESSSEEESE`

---

## 7. Famille 5 : Sanctuaires de réseaux et logique (`network`)

Transbordeurs de téléportation multi-îles et relais logiques booléens à double chambre.

### 7.1 Transbordeur téléporteur multi-îles (`portal_islands`, Palier 3)
Poussez un rocher à travers un anneau téléporteur coloré vers une île isolée afin qu'il atterrisse sur une dalle, puis suivez par un second portail.

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

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `O` = `teleport_red` ; `o` = `teleport_blue` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `dirt_block`, `teleport_red`, `teleport_blue`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `EESEEESSWWW`

### 7.2 Relais logique à double chambre (`signal_relay`, Palier 5)
Alimentez simultanément une dalle de signal et un récepteur laser câblés sur une porte logique ET pour ouvrir la porte du sanctuaire central.

```text
#########
#P$.!..]#
#...\.#C#
#>....#S#
#...R.#E#
##&######
#########
```

- **Légende** : `P` = `floor, départ : S` ; `$` = `floor, entité : dirt_block` ; `!` = `signal_plate` ; `&` = `signal_gate_and` ; `>` = `laser_emitter_e` ; `\` = `floor, entité : mirror_backslash` ; `R` = `laser_receiver_red` ; `]` = `hold_door_red_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `signal_plate`, `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `signal_gate_and`, `hold_door_red_closed`, `dirt_block`, `dirt`, `socket`
- **Solution vérifiée** : `SEENESWWWNEESEENEESSS`

---

## 8. Famille 6 : Automates de monstres et de chars (`automata`)

Horloges à balles rebondissantes en chambre scellée, échappements à pièges et convois de chars pilotés par bouton bleu.

### 8.1 Horloge à échappement de balle rose (`monster_clock`, Palier 2)
Synchronisez votre passage à travers une porte maintenue ouverte périodiquement par une balle rose rebondissant en chambre scellée.

```text
#########
#P..#o.[#
#...#####
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `o` = `floor, entité : pink_ball (E)` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `pink_ball`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `EES.SSEEEE`

### 8.2 Échappement à piège de relâchement (`trap_escapement`, Palier 3)
Maintenez un bouton marron pour libérer un char captif d'un piège vers une dalle de pression scellée.

```text
#########
#P..#T.[#
#.b.#####
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `b` = `button_brown` ; `T` = `trap, entité : tank (E)` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `button_brown`, `trap`, `tank`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `SE..E.SSEEEE`

### 8.3 Convoi de char à bouton bleu (`tank_convoy`, Palier 4)
Actionnez un bouton bleu d'inversion pour retourner un char à l'arrêt et l'envoyer sur une dalle de maintien scellée.

```text
#########
#P..#[.t#
#.u.#####
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `u` = `button_blue` ; `t` = `floor, entité : tank (E)` ; `[` = `pressure_plate_blue` ; `]` = `hold_door_blue_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `button_blue`, `tank`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket`
- **Solution vérifiée** : `SE..E.SSEEEE`

---

## 9. Famille 7 : Aiguillages ferroviaires et réseaux de transit (`transit`)

Voies ferrées guidées, aiguillages commandés par bouton vert, distributeurs à tapis tournants et portails de poche portatifs.

### 9.1 Triage d'aiguillage ferroviaire (`rail_switchyard`, Palier 3)
Basculez un aiguillage ferroviaire avec un bouton vert avant de libérer un char captif afin qu'il bifurque vers la dalle de la voie est.

```text
#########
#P..#?-[#
#gb.#|###
#...#T###
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `g` = `button_green` ; `b` = `button_brown` ; `T` = `trap, entité : tank (N)` ; `|` = `rail_ns` ; `?` = `rail_switch_b` ; `-` = `rail_ew` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `button_green`, `button_brown`, `trap`, `tank`, `rail_ns`, `rail_switch_b`, `rail_ew`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `SE..ES..SSEEEE`

### 9.2 Distributeur à tapis tournant (`turning_force_distributor`, Palier 3)
Amorcez le cycle partagé des tapis tournants sur une dalle adossée à un mur afin que le rocher suivant soit dévié vers le sud sur une dalle de maintien.

```text
#########
#P@#....#
#..#.$@.#
#.....#[#
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `@` = `force_cycle` ; `$` = `floor, entité : dirt_block` ; `[` = `pressure_plate_green` ; `]` = `hold_door_green_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `force_cycle`, `dirt_block`, `pressure_plate_green`, `hold_door_green_closed`, `socket`
- **Solution vérifiée** : `SESEENEENESWSWWSSEEEE`

### 9.3 Navette à porte de poche portative (`pocket_gate_shuttle`, Palier 4)
Ramassez une porte de poche portative, posez-la dans un couloir de poussée et téléportez un rocher dans une chambre scellée sur sa dalle.

```text
#########
#Pgd.#o[#
#.d$.####
#.......#
###]#####
###C..SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `g` = `floor, objet : pocket_gate` ; `o` = `pocket_gate_pad` ; `$` = `floor, entité : dirt_block` ; `d` = `dirt` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `pocket_gate`, `pocket_gate_pad`, `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EEESGNWWSESSSEEEE`

---

## 10. Famille 8 : Balistique, démolition et sceaux (`ballistics`)

Charges explosives temporisées dégageant des barricades, pierres de jet ricochant sur miroirs et sceaux protecteurs contre les rôdeurs.

### 10.1 Brèche par charge explosive temporisée (`blast_charge_breach`, Palier 3)
Poussez un rocher sur un bouton vert à sens unique pour ouvrir un mur alternatif sur un laser, puis faites exploser une charge temporisée pour dégager le faisceau.

```text
#########
#Pxd..:C#
#..d$.#S#
####+v#E#
#>.+.gR##
#########
```

- **Légende** : `P` = `floor, départ : S` ; `x` = `floor, objet : charge` ; `$` = `floor, entité : dirt_block` ; `v` = `force_s` ; `g` = `button_green` ; `+` = `toggle_wall_closed` ; `>` = `laser_emitter_e` ; `R` = `laser_receiver_red` ; `:` = `laser_gate_red_closed` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `charge`, `dirt_block`, `force_s`, `button_green`, `toggle_wall_closed`, `laser_emitter_e`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket`
- **Solution vérifiée** : `EESENESWSXNWW...............NEEEEESS`

### 10.2 Pierre de jet à ricochet sur miroir (`hurl_stone_ricochet`, Palier 3)
Poussez un miroir diagonal en tête d'un canal d'eau et lancez une pierre vers l'est afin qu'elle ricoche à 90 degrés vers le sud sur une bombe.

```text
#########
#Phd.\..#
#####.W##
#####>*d#
#######C#
#######S#
#######E#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `h` = `floor, objet : hurl_stone` ; `\` = `floor, entité : mirror_backslash` ; `W` = `water` ; `>` = `force_e` ; `*` = `floor, objet : bomb` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `hurl_stone`, `mirror_backslash`, `water`, `bomb`, `force_e`, `dirt`, `socket`
- **Solution vérifiée** : `EEEET.SSESSS`

### 10.3 Gambit d'égide et de guetteur endormi (`ward_lurker_gambit`, Palier 4)
Réveillez un guetteur endormi à travers une paroi fine pour l'amener sur une dalle de maintien, puis franchissez la porte et absorbez le contact avec une égide.

```text
#########
#Pw.|L###
#...][C.#
######SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `w` = `floor, objet : ward` ; `|` = `thin_wall_e` ; `L` = `floor, entité : lurker_dormant (S)` ; `[` = `pressure_plate_red` ; `]` = `hold_door_red_closed` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `ward`, `lurker_dormant`, `thin_wall_e`, `pressure_plate_red`, `hold_door_red_closed`, `socket`
- **Solution vérifiée** : `EEEWEWSEEEES`

---

## 11. Famille 9 : Parité d'alternance et péages d'équipement (`parity`)

Tissages de parité à murs alternatifs verts et rouges, et écluses nécessitant des bottes suivies de voleurs et portiques d'interdiction.

### 11.1 Tissage de parité à double canal (`toggle_parity_weave`, Palier 3)
Alternez boutons verts et rouges pour faire progresser un rocher à travers des murs alternatifs déphasés et combler les douves.

```text
#########
#P.g.r..#
#.$.+.%.#
######W##
######dC#
######SE#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `g` = `button_green` ; `r` = `toggle_button_red` ; `+` = `toggle_wall_closed` ; `%` = `toggle_wall_red_closed` ; `$` = `floor, entité : dirt_block` ; `W` = `water` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `button_green`, `toggle_button_red`, `toggle_wall_closed`, `toggle_wall_red_closed`, `dirt_block`, `water`, `dirt`, `socket`
- **Solution vérifiée** : `EEWWSEEENEWSENEWESSSES`

### 11.2 Écluse à bottes de feu et péage du voleur (`thief_boot_toll`, Palier 3)
Équipez des bottes de feu pour pousser un rocher depuis une case de feu vers l'eau, puis cédez vos bottes au voleur pour franchir le portique d'interdiction.

```text
#########
#PfdF..T#
###.$...#
####W####
####d####
####!C.S#
#######E#
#########
```

- **Légende** : `P` = `floor, départ : S` ; `f` = `floor, objet : boots_fire` ; `F` = `fire` ; `T` = `thief` ; `!` = `forbid_boots_fire` ; `$` = `floor, entité : dirt_block` ; `W` = `water` ; `d` = `dirt` ; `C` = `floor, objet : chip` ; `S` = `socket` ; `E` = `exit`
- **Mécanismes clés** : `boots_fire`, `fire`, `dirt_block`, `water`, `thief`, `forbid_boots_fire`, `dirt`, `socket`
- **Solution vérifiée** : `EEESNEEESWWWSSSEEES`

---

## 12. Composition et chaînage de sanctuaires multi-salles

Pour construire un niveau de sanctuaire complet (15x15 à 25x25) en chaînant les archétypes de cette encyclopédie :

1. **Architecture en moyeu et ailes (Hub-and-Wings)** : placez un hall central abritant la porte finale du sanctuaire (`hold_door_*_closed`, `laser_gate_*_closed` ou `socket` + `exit`), entouré de 2 à 4 ailes contenant chacune un archétype (`boulder_sluice`, `grappling_alcove`, `prism_slalom`, `rail_switchyard`, `tank_convoy`).
2. **Progression par outil** : placez `boots_pull`, `pocket_gate`, `hurl_stone` ou `charge` comme récompense d'une première aile, ce qui déverrouille les rochers encastrés, interrupteurs distants ou barricades des ailes suivantes.
3. **Pièces procédurales de sanctuaire (`public/configs/motifs.json`)** : 10 pièces `sanctuary_*` de palier 5 (`sanctuary_sluice_double_trench`, `sanctuary_alchemy_fire_water_sluice`, `sanctuary_counterweight_trap_bridge`, `sanctuary_glacier_corner_sluice`, `sanctuary_conveyor_sluice`, `sanctuary_portal_ferry_sluice`, `sanctuary_toggle_parity_sluice`, `sanctuary_thief_fire_sluice`, `sanctuary_tank_reversal_bridge`, `sanctuary_trap_release_sluice`) intègrent directement ces mécanismes dans les packs procéduraux et le mode Infini.
