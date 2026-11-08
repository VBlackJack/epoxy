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
- **Invariants de conception** :
  - Gardez au moins une case de sol praticable derrière le rocher, sur son axe de poussée, pour que le joueur puisse s'aligner sur la tranchée.
  - Placez toujours un socket ou une porte fermée avant la sortie quand un bloc existe sur la carte, afin d'éviter les avertissements socket_bypass.
  - Marcher sur la case de terre obtenue la compacte en sol ordinaire.
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
- **Invariants de conception** :
  - Un dirt_block qui s'enfonce dans l'eau crée une case de terre, qui bloque les entités suivantes tant que le joueur n'a pas marché dessus.
  - Le joueur doit marcher sur la première case comblée puis revenir dans la salle de préparation avant de pousser le second rocher.
  - Prévoyez une boucle ou une salle de préparation large pour que le second rocher puisse être amené dans la même colonne.
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
- **Invariants de conception** :
  - Un ice_block poussé dans le feu fond et transforme le bloc et le feu en une case d'eau.
  - Un dirt_block poussé dans un feu nu s'arrête ou ne comble rien ; l'ice_block doit toujours entrer en premier.
  - Placez l'ice_block plus près du goulet de feu, ou dans une voie parallèle, pour enchaîner proprement les deux blocs.
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
- **Invariants de conception** :
  - Une case hold_door_<couleur>_closed ne s'ouvre que tant que chaque pressure_plate_<couleur> de la même couleur sur la carte est enfoncée.
  - Placez la dalle de pression au bout d'une voie de poussée ou contre un mur d'arrêt, pour que le rocher s'arrête bien à plat sur la dalle.
  - Ne démarrez jamais une porte de maintien ouverte, sauf si toutes les dalles de sa couleur démarrent enfoncées.
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
- **Invariants de conception** :
  - Avec boots_pull équipées, s'éloigner d'un bloc adjacent tire ce bloc dans l'ancienne case du joueur.
  - Prévoyez toujours une case latérale perpendiculaire au bout du couloir de traction pour que le joueur puisse se décaler sans retirer le bloc.
  - Gardez les objets à ramasser dans une alcôve à trois murs ou derrière une case de terre, pour que les blocs tirés ne puissent pas les recouvrir.
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
- **Invariants de conception** :
  - Séparez le rocher supérieur des gants de grappin par une case de terre, pour que le rocher supérieur ne puisse pas recouvrir les gants.
  - Le fossé d'eau force à consommer le premier rocher comme pont, ce qui prouve que le second rocher encastré est nécessaire pour la dalle.
  - Prévoyez une poche de dégagement de 2 rangées de l'autre côté du couloir inférieur pour que le joueur puisse monter au Nord et se placer derrière le rocher tiré.
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
- **Invariants de conception** :
  - Placez un mur d'arrêt plein derrière la case cible du premier miroir, pour que le faisceau non réfléchi ne coupe jamais la route de sortie du joueur.
  - Disposez les miroirs mobiles une case hors de la ligne du faisceau actif, pour que le joueur les pousse dans le faisceau sans marcher sur une case de faisceau actif.
  - Protégez le couloir de sortie par une case de terre pour que les miroirs ne puissent pas être poussés sur le chip ou le socket.
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
- **Invariants de conception** :
  - Confinez le faisceau laser actif non réfléchi dans une poche d'une case contre un mur, pour que le joueur ne traverse jamais le faisceau en tirant le miroir.
  - Tirez le miroir hors de l'alcôve vers une case de préparation sûre, montez au Nord dans la poche de dégagement, puis poussez le miroir vers l'Est dans le faisceau.
  - Protégez le couloir de sortie et l'alcôve des gants de grappin avec des cases de terre pour que le miroir ne puisse pas recouvrir les objets à ramasser.
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
- **Invariants de conception** :
  - Placez les deux miroirs une case au Nord de leurs rangées de faisceau, pour que les pousser vers le Sud dans les faisceaux garde le joueur dans la voie supérieure sûre.
  - Deux faisceaux laser peuvent se croiser à angle droit sur une case de sol libre sans interférer l'un avec l'autre.
  - Enchaînez laser_gate_red_closed et laser_gate_blue_closed en série pour que les deux récepteurs doivent rester éclairés en même temps.
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
- **Invariants de conception** :
  - Un bloc poussé sur la glace glisse jusqu'à heurter une case non glacée, un mur ou un déflecteur d'angle.
  - Utilisez ice_ne (dévie E vers S et N vers W) dans l'angle supérieur droit de la voie de glissade, pour qu'un bloc poussé vers l'Est tourne vers le Sud sur la dalle.
  - Placez un mur immédiatement au Sud de la dalle de pression cible, pour que le bloc glissant s'arrête sur la dalle et ne puisse pas entrer dans la salle inférieure.
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
- **Invariants de conception** :
  - Un bloc poussé sur un sol de force glisse automatiquement dans la direction de la force à chaque tick, jusqu'à atteindre une case normale.
  - Terminez le tapis de force directement sur une dalle de pression ou une tranchée d'eau avec un mur derrière, pour que le bloc se stabilise proprement.
  - Gardez l'approche du joueur perpendiculaire à l'entrée du tapis, pour que le joueur ne marche jamais sur le courant à sens unique.
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
- **Invariants de conception** :
  - Chaque clone_machine exige à la fois un cloneLink explicite depuis un button_red et une entité modèle posée sur la case de la machine.
  - Orientez l'entité modèle pour qu'elle apparaisse dans une voie de poussée dégagée où le joueur peut se placer derrière le bloc créé.
  - Après avoir poussé le premier bloc cloné dans l'eau, compactez la terre obtenue avant de faire apparaître et de pousser un second bloc.
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
- **Invariants de conception** :
  - Chaque groupe de téléporteurs d'un niveau doit compter au moins deux téléporteurs de la même couleur, pour éviter les avertissements teleport_alone.
  - Une entité ou le joueur qui entre dans un téléporteur en direction D sort du téléporteur de destination une case plus loin dans la direction D.
  - Scellez par des murs les côtés inutilisés du téléporteur d'arrivée du joueur, pour qu'une porte de maintien fermée côté sortie ne puisse pas être contournée par les directions de repli.
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
- **Invariants de conception** :
  - Un signal_gate_and exige deux signalLinks entrants issus de sources valides (signal_plate ou laser_receiver_*) et un lien sortant vers un récepteur (hold_door_*_closed).
  - Quand une hold_door_<couleur>_closed est pilotée par un lien de signal, elle ignore les dalles de pression isolées et ne s'ouvre que lorsque sa source de signal est haute.
  - Placez le miroir une case au Nord du faisceau de l'émetteur, pour que le pousser vers le Sud dans le faisceau garde le joueur dans la voie supérieure sûre.
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
- **Invariants de conception** :
  - Une pink_ball avance en ligne droite jusqu'à heurter un mur puis fait demi-tour de 180 degrés, sans tourner dans les couloirs latéraux.
  - Les monstres marcheurs enfoncent les dalles de pression de couleur tant qu'ils se tiennent dessus, ce qui permet à une salle scellée de pulser une porte de maintien.
  - Gardez la piste de l'horloge longue de 2 à 3 cases pour que la porte de maintien s'ouvre à un rythme prévisible, sans longues attentes.
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
- **Invariants de conception** :
  - Un bouton brun maintient son piège lié ouvert seulement tant qu'un acteur se tient sur le bouton ; attendez sur le bouton que le monstre captif sorte.
  - Un tank libéré sur une voie droite s'arrête contre le mur du fond et maintient indéfiniment la dalle de pression terminale.
  - Tout piège qui retient une entité doit avoir un trapLink explicite depuis un bouton brun accessible.
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
- **Invariants de conception** :
  - Contrairement aux autres monstres, un tank s'arrête complètement face à un mur et ne change de direction que lorsqu'un button_blue est pressé.
  - Faites partir le tank face à un mur à une extrémité d'une salle scellée, et placez la dalle de pression cible contre le mur opposé.
  - Presser button_blue un nombre pair de fois avant que le tank atteigne la dalle l'éloigne de nouveau de la cible.
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
- **Invariants de conception** :
  - Un rail_switch_b relie le Sud et l'Ouest par défaut et bascule en rail_switch_a (Sud et Est) quand un button_green est pressé.
  - Incluez toujours au moins un button_green ou un fil de bascule de signal sur une carte à aiguillages, pour éviter les notes du validateur rail_switch_no_button.
  - Les monstres qui avancent, comme les tanks, tournent automatiquement pour suivre le côté de sortie ouvert de chaque pièce de rail.
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
- **Invariants de conception** :
  - Tous les patins force_cycle d'un niveau partagent un unique compteur de rotation global qui parcourt E, S, O, N à chaque arrivée d'un acteur.
  - Marcher sur un patin force_cycle d'amorçage adossé à un mur Est consomme la poussée initiale vers l'Est (tour 0), de sorte que l'arrivée suivante pousse vers le Sud (tour 1).
  - Placez un mur à l'Est du patin distributeur pour qu'une poussée de rocher non amorcée (tour 0, Est) cale au lieu d'atteindre la dalle du Sud.
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
- **Invariants de conception** :
  - Un niveau qui utilise des portes de poche a besoin d'au moins deux patins au total (objets pocket_gate portés plus cases pocket_gate_pad posées) pour qu'ils se lient dans le validateur.
  - Déposer une pocket_gate (action G) exige un sol ordinaire vide sous le joueur et convertit cette case en pocket_gate_pad.
  - Scellez le pocket_gate_pad de destination sur trois côtés pour qu'un bloc poussé vers l'Est dans le patin déposé sorte vers l'Est sur la dalle de pression.
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
- **Invariants de conception** :
  - Une charge allumée (action X) détone après 60 ticks (15 pas d'attente) et détruit tous les blocs et monstres d'un carré de 3x3, même à travers un mur d'une case.
  - Placez un toggle_wall_closed dans la rangée du laser pour que le faisceau soit bloqué jusqu'à ce que le rocher glisse le long de force_s sur button_green.
  - Reculez d'au moins 2 cases en X ou en Y après avoir allumé la charge, pour que le joueur se trouve hors du carré d'explosion de 3x3.
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
- **Invariants de conception** :
  - Une hurl_stone lancée (action T) parcourt les cases transparentes au laser, se réfléchit sur la face réfléchissante d'un miroir et fait détoner un objet bombe au contact.
  - Placer de l'eau directement au Sud de l'angle du miroir empêche le joueur de tourner vers le Sud sur cette case sans se noyer, ce qui force le ricochet sur le miroir.
  - Attendez un pas après avoir lancé la pierre pour que le projectile atteigne et dégage la bombe avant de marcher sur la goulotte d'entrée force_e.
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
- **Invariants de conception** :
  - Chaque lurker_dormant et lurker doit être placé sur un terrain de sol ordinaire pour satisfaire le contrôle du validateur lurker_not_on_floor.
  - Un lurker_dormant se réveille en lurker poursuiveur dès que le joueur termine un pas à distance de Manhattan 1, même à travers un mur mince.
  - Équiper un ward absorbe exactement un contact avec un monstre, ce qui permet au joueur de traverser le lurker posé sur la dalle de maintien après avoir franchi la porte de maintien.
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
- **Invariants de conception** :
  - Les boutons verts ne basculent que les cases toggle_wall_open / toggle_wall_closed vertes ; les boutons de bascule rouges ne basculent que les cases toggle_wall_red_open / toggle_wall_red_closed.
  - Les deux boutons doivent être accessibles pour que LevelValidator puisse ouvrir les deux canaux de bascule pendant l'analyse d'accessibilité.
  - Prévoyez un contournement latéral de la voie du rocher pour que le joueur puisse atteindre les boutons et se replacer derrière le rocher après chaque ouverture de porte.
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
- **Invariants de conception** :
  - Placer du feu sur la seule case derrière le rocher force le joueur à ramasser et à porter boots_fire avant de pousser le rocher dans l'eau.
  - Une case forbid_boots_fire bloque l'entrée tant que le joueur porte boots_fire, ce qui impose de passer sur une case voleur après la poussée du rocher.
  - Gardez la case du voleur dans une alcôve latérale hors du couloir principal pour que le joueur ne se dépouille pas par accident de boots_fire avant de pousser le rocher.
- **Solution vérifiée** : `EEESNEEESWWWSSSEEES`

---

## 12. Composition et chaînage de sanctuaires multi-salles

Pour construire un niveau de sanctuaire complet (15x15 à 25x25) en chaînant les archétypes de cette encyclopédie :

1. **Architecture en moyeu et ailes (Hub-and-Wings)** : placez un hall central abritant la porte finale du sanctuaire (`hold_door_*_closed`, `laser_gate_*_closed` ou `socket` + `exit`), entouré de 2 à 4 ailes contenant chacune un archétype (`boulder_sluice`, `grappling_alcove`, `prism_slalom`, `rail_switchyard`, `tank_convoy`).
2. **Progression par outil** : placez `boots_pull`, `pocket_gate`, `hurl_stone` ou `charge` comme récompense d'une première aile, ce qui déverrouille les rochers encastrés, interrupteurs distants ou barricades des ailes suivantes.
3. **Pièces procédurales de sanctuaire (`public/configs/motifs.json`)** : 10 pièces `sanctuary_*` de palier 5 (`sanctuary_sluice_double_trench`, `sanctuary_alchemy_fire_water_sluice`, `sanctuary_counterweight_trap_bridge`, `sanctuary_glacier_corner_sluice`, `sanctuary_conveyor_sluice`, `sanctuary_portal_ferry_sluice`, `sanctuary_toggle_parity_sluice`, `sanctuary_thief_fire_sluice`, `sanctuary_tank_reversal_bridge`, `sanctuary_trap_release_sluice`) intègrent directement ces mécanismes dans les packs procéduraux et le mode Infini.


---

## 13. Référence des mécanismes

Les mécanismes ajoutés après ces archétypes (cases de voies, auvent, poussée en chaîne, dynamite, portes logiques et ports, nouveaux monstres, joueurs miroirs et plusieurs joueurs de Chip's Challenge 2 ; porte des Poissons, téléporteurs et monstres de Chuck's Challenge 3D ; dispositifs à signal) sont décrits pour les auteurs de niveaux, avec la façon de placer et de configurer chacun dans l'éditeur, dans la [Référence des mécanismes](./mechanisms.md) ([English version](../mechanisms.md)). Ce sont des mécanismes aux règles Epoxy, enregistrés au format de pack 13.
