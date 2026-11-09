*English version: [../mechanisms.md](../mechanisms.md)*

# Référence des mécanismes pour les auteurs de niveaux

Cette page recense les mécanismes ajoutés après les archétypes de sanctuaire de l'[Encyclopédie des énigmes et mécanismes](./puzzle-encyclopedia.md), regroupés par origine : Chip's Challenge 2 (CC2), Chuck's Challenge 3D (CC3D) et Epoxy lui-même. Pour chacun, elle dit ce qu'il fait et comment le placer et le configurer dans l'éditeur de niveaux. Chaque affirmation suit le moteur, les descriptions de tuiles et d'entités des fichiers de langue (`src/locales/fr.json`) et le [journal des modifications](../../CHANGELOG.md) (en anglais).

## 0. Avant de commencer

- **Règles Epoxy uniquement.** Tous les mécanismes ci-dessous sont joués par le moteur Epoxy. Un niveau Lynx ne peut pas les contenir (le champ `Règles` de l'éditeur fait passer un niveau des règles Epoxy aux règles Lynx), et un niveau CC3D natif a sa propre palette. La conversion CC3D et l'import CC2 produisent des niveaux aux règles Epoxy qui utilisent ces mécanismes.
- **Formats de pack 13 et 14.** Les niveaux qui les utilisent s'écrivent au format de pack 13 (`PACK_JSON_VERSION_V13`) ; les mécanismes CC2 de la section 1.14 demandent le format de pack 14.
- **Placement.** Choisissez l'entrée dans la palette de l'éditeur (le champ de recherche liste chaque variante par son nom) et peignez-la. Les entrées qui existent en variantes (panneaux interdits, compteurs, portes pivotantes, portes pivotantes CC2, interrupteur) occupent une seule entrée de palette : `R` fait passer le pinceau d'une variante à l'autre de la famille, l'entrée montre la variante en main, et la pipette prend la variante sous le curseur.
- **Rotation.** `R` fait tourner le pinceau dans le sens horaire (ou passe à la variante suivante). `Maj+R` tourne la créature ou la tourelle sous le curseur, un tampon flottant ou, pour une case de voies, ses voies d'un quart de tour.
- **Liaisons.** `K` commence ou termine une liaison depuis le dispositif sous le curseur. La section Connexions de l'inspecteur liste ce que le dispositif commande et ce qui le commande, et la fiche "Comment fonctionnent les mécanismes" résume comment les parties de chaque mécanisme se trouvent.
- **Inspecteur de cellule.** La section Cellule de l'inspecteur montre la case sous le curseur. La case de voies y ajoute sa propre section.
- **Validateur.** Le validateur suit tous ces mécanismes ; les avertissements propres à chacun sont nommés dans les entrées ci-dessous.

## 1. Venus de Chip's Challenge 2

L'import CC2 (fichiers `.c2m`, scripts de jeu `.c2g` ou dossier entier) convertit ces mécanismes et donne à chaque niveau un badge de couverture : exact, approximatif ou non jouable.

### 1.1 Cases de voies et panneau de chemin de fer

- **Ce que ça fait.** Une case de voies (`rail_junction` avec une entrée `railTracks` propre au niveau) porte jusqu'à six segments : quatre courbes (nord-est, sud-est, sud-ouest, nord-ouest) et deux droites (est-ouest, nord-sud). Ce qui entre (joueur, bloc ou monstre) doit passer par un côté qu'un segment ouvre, et ne ressort que le long d'un segment qui rejoint le côté d'entrée. Un pas refusé est dévié : tout droit, à droite, à gauche, demi-tour. Une case à aiguillage utilise un segment à la fois (le segment ouvert) et passe au suivant quand quelque chose repart par le segment actif, ou quand elle reçoit une impulsion. Les blocs peuvent reculer. Le panneau de chemin de fer, une fois ramassé, empêche les cases de voies de limiter l'entrée et la sortie de son porteur ; un voleur le prend avec les autres bottes. Les rails natifs sont inchangés.
- **Placement.** La case de voies est dans le groupe Rails de la palette et démarre comme une droite nord-sud.
- **Configuration.** Une section de l'inspecteur de cellule, "Cellule de rails en (x, y)", propose une bascule par segment, le choix du segment ouvert de l'aiguillage (ou "Pas d'aiguillage") et une action Effacer. `Maj+R` tourne d'un quart de tour toutes les voies de la case.
- **Validateur.** Il avertit d'une case de voies sans segment (personne ne peut y entrer). Son parcours d'accessibilité n'entre dans une case de voies que par un côté ouvert et en ressort le long d'un segment qui rejoint le côté d'entrée ; un panneau de chemin de fer accessible ouvre toutes les voies.

### 1.2 Auvent et bloc fléché verrouillé

- **Auvent.** Un drapeau d'arête de cellule, dessiné comme un toit semi-opaque au-dessus de la case. Il empêche les insectes et les rôdeurs d'y entrer, et une goutte ne peut pas passer entre deux cases à auvent.
  - **Placement.** Le pinceau Auvent est dans l'onglet Terrain. Un clic active ou retire l'auvent d'une case et conserve ses murs minces. Un glisser applique à tout le trait le choix fait sur la première case. La gomme l'efface. Un auvent ne peut pas remplir une sélection (`Maj+F` est refusé) : dessinez-le au pinceau.
- **Bloc fléché verrouillé.** Un bloc fléché sans flèche (`arrow_block_none`) : aucune poussée ne le déplace, qu'elle vienne du joueur, d'un monstre ou d'un autre bloc. Il glisse encore sur la glace ou un sol de force, et pousse encore comme les autres blocs fléchés. Placez-le depuis la palette comme n'importe quel bloc.

### 1.3 Poussée en chaîne

- **Ce que ça fait.** Un bloc de glace pousse les blocs de glace et les blocs fléchés ; un bloc fléché pousse les blocs de terre, de glace et fléchés. Une file de blocs avance en une seule poussée. Un mur, le bord de la carte ou un bloc qui glisse devant refuse toute la poussée. Un bloc qui glisse lui-même n'est jamais poussé, et rien n'est jamais poussé sur le joueur. Un bloc qui glisse (sur la glace ou un sol de force) pousse le bloc immobile qu'il atteint selon les mêmes règles de chaîne. Les pantins et les bottes de traction ne chaînent jamais. Un bloc de glace ne pousse jamais directement un bloc de terre.
- **Configuration.** Il n'y a rien à placer : la règle est un champ propre à chaque bloc (`chainPushes`). Disposez les niveaux avec des blocs ordinaires. Les anciens rejeux (formats de pack 1 à 12) qui poussaient un bloc dans un autre pouvaient différer ; les solutions fournies ne sont pas touchées.
- **Règle liée.** Un bloc de glace poussé dans l'eau transforme l'eau en glace (règles Epoxy) ; poussé dans le feu, il le fond toujours en eau. Le validateur compte un bloc de glace comme un remblai pour l'eau.

### 1.4 Dynamite

- **Ce que ça fait.** Ramassez-la et posez-la ; elle s'allume quand vous quittez sa case. 85 ticks plus tard, elle souffle une zone de 5 x 5 sans ses quatre coins éloignés. Le souffle détruit murs, portes et la plupart des terrains, les objets et toute créature prise dedans, et transforme en feu le sol sous une créature. Les murs d'acier, les sockets et les portes logiques résistent. Un souffle ne déclenche pas d'autre dynamite. Une dynamite allumée ne bloque rien et ne peut pas être ramassée.
- **Placement.** Entrée de palette `Dynamite`. L'import CC2 y convertit la dynamite ; la charge explosive d'Epoxy est inchangée.

### 1.5 Puces vertes, bombes vertes, murs d'acier, feuille d'acier

- **Puce verte et bombe verte.** La puce verte compte comme une puce (et dans le nombre de puces requises) ; la bombe verte explose comme une bombe. Chaque appui sur un bouton vert transforme chacune en l'autre.
- **Mur d'acier.** Un mur qu'aucun souffle ne peut détruire.
- **Feuille d'acier.** Ramassez-la et gardez-la : heurter un mur ordinaire le transforme en mur d'acier ; vous ne bougez pas et la feuille n'est pas consommée. Un voleur la prend.
- **Placement.** Entrées de palette ; rien d'autre à configurer.

### 1.6 Personnages : Melinda, chaussures de randonnée, panneaux, transmogrificateur

- **Personnage.** Un réglage `character` propre au niveau (Chip par défaut, omis du fichier pour Chip), choisi dans les réglages du niveau, joue le niveau avec Melinda. Elle ne glisse pas sur la glace et a besoin de chaussures de randonnée sur la terre et le gravier ; les chaussures ne font rien pour Chip.
- **Panneaux.** Les panneaux réservés à Chip et à Melinda n'arrêtent que l'autre personnage ; monstres et blocs passent.
- **Transmogrificateur.** Marcher dessus fait passer le joueur de Chip à Melinda, et inversement, les règles du personnage courant suivant ; l'annulation le rétablit. Le validateur traite un niveau avec transmogrificateur comme jouable par l'un ou l'autre personnage.
- **Dents.** Les dents ordinaires fuient Melinda ; les dents timides fuient Chip et poursuivent Melinda.

### 1.7 Panneaux interdits

- **Ce que ça fait.** Panneaux de la couche d'objets `no_sign_<objet>` (clés, toutes les bottes, bottes de vitesse et de vue, ward, chaussures de randonnée, charge explosive, dynamite, porte de poche, pierre à lancer, jeton de péage, feuille d'acier, pot-de-vin, éclair). L'objet ne peut pas y être ramassé, et un joueur qui le porte ne peut pas entrer dans la case. Le terrain sous le panneau continue de fonctionner ; les blocs passent, les monstres non.
- **Placement.** Une entrée de palette pour la famille ; `R` fait défiler les variantes. L'import CC2 les utilise pour un panneau interdit posé sur tout autre objet ou sur un terrain qui n'est pas du sol (approximatif) ; sur un bonus ou une horloge à bascule, le panneau est abandonné.

### 1.8 Portes pivotantes CC2

- **Ce que ça fait.** `swivel_door_cc2_*` : les côtés fermés n'empêchent que l'entrée. Sortir par un côté fermé fait pivoter la porte (dans le sens horaire quand le côté suivant dans ce sens est lui aussi fermé, sinon dans le sens antihoraire) ; sortir par un côté ouvert ne la fait pas tourner. Les portes pivotantes natives sont inchangées.
- **Placement.** Une entrée de palette ; `R` fait défiler les quatre variantes d'angle.

### 1.9 Objets

- **Horloge à bascule.** Reste sur la carte. Marcher dessus met le chronomètre du niveau en pause ; marcher de nouveau dessus le relance (un indicateur PAUSE s'affiche dans le HUD). Monstres et blocs ne peuvent pas entrer dans sa case. Elle ne fait rien sur un niveau sans limite de temps.
- **Pot-de-vin.** Ramassez-le et gardez-le. Chaque fois que vous marchez sur un voleur, un pot-de-vin est dépensé et rien n'est pris. Il ne peut pas être posé, et un voleur ne le prend jamais.
- **Éclair.** Tant que le joueur le porte, le sol conducteur sur lequel il se tient alimente ses réseaux de signaux. CC2 demande aussi au porteur de rester immobile et alimente des réseaux à travers un sol électrifié ; ni l'un ni l'autre n'est joué, l'éclair est donc marqué approximatif.

### 1.10 Logique : NON-ET, verrou de données, compteur, ports nommés

- **Porte NON-ET.** Envoie un signal sauf si tous les signaux qui y sont liés sont émis.
- **Verrou de données.** Mémorise le signal de sa liaison de données (port `in0`) tant que sa liaison d'horloge (port `in1`) émet, et envoie ce qu'il a mémorisé. Les deux verrous CC2 se jouent comme un verrou de données ; le verrou à bascule est inchangé.
- **Compteur (0 à 9).** Compte à chaque début d'émission de sa première entrée (`in0`) et décompte à chaque début d'émission de la seconde (`in1`), de 0 à 9. Dépasser 9 envoie une courte impulsion sur `out0` ; passer sous 0 émet sur `out1` jusqu'au comptage suivant. Une entrée de palette ; `R` fait défiler la valeur de départ.
- **Ports.** Les ports des portes (`in0`/`in1`, `out0`/`out1`) sont portés par les liaisons de signal. Voir la section 3.3 pour les voir et les échanger dans l'éditeur.

### 1.11 Monstres

- **Mimétique du sol.** Poursuit le joueur comme des dents mais quatre fois plus lentement, et ressemble presque à du sol ordinaire (seule une marque discrète le montre dans l'éditeur). Tue au contact.
- **Dents timides.** Fuient Chip et poursuivent Melinda.
- **Fantôme.** Traverse murs, portes, sockets et murs minces, mais pas les murs d'acier, les machines à cloner, l'eau ni les nénuphars. La glace, les sols de force, les rails, les pièges, les bombes, le feu et la boue ne lui font rien ; il marche sur les objets sans les ramasser et actionne les boutons qu'il croise.
- **Rôdeur.** Se déplace tour à tour comme les dents, le planeur, l'insecte, la balle rose, les dents timides, la boule de feu, le paramécie et le marcheur, en changeant toutes les 32 décisions.
- **Placement.** Entrées de palette ; `Maj+R` tourne la créature sous le curseur.

### 1.12 Joueurs miroirs

- **Ce qu'ils font.** Chip miroir et Melinda miroir copient chaque mouvement que tente le joueur de leur personnage (mouvements bloqués compris) et ne font rien quand l'autre personnage est le joueur. Ils suivent les règles de terrain de ce personnage, ouvrent les portes de leur propre couleur de clé (verte pour Chip, jaune pour Melinda) sans utiliser la clé, ramassent clés et outils mais pas les puces, poussent un bloc, pressent les boutons et meurent sur les dangers sans mettre fin au niveau. Les toucher tue le joueur.
- **Placement.** Entrées de palette `Chip miroir` et `Melinda miroir` ; `Maj+R` tourne la créature sous le curseur.

### 1.13 Plusieurs joueurs dans un niveau

- **Ce que ça fait** (règles Epoxy). Un seul joueur est commandé à la fois et un échange passe la main au suivant. Les autres ne font aucun pas de leur propre initiative mais glissent encore et peuvent être tués. Chaque joueur garde ses propres clés, outils et personnage ; les puces sont partagées. Un joueur qui atteint une sortie quitte le jeu, et tous les joueurs doivent sortir pour gagner. L'annulation et les mouvements enregistrés incluent les échanges. Les niveaux à un seul joueur sont inchangés.
- **Placement.** L'outil Deuxième joueur place des départs de joueurs supplémentaires (jusqu'à 7 de plus) ; le contrôle de direction règle l'orientation, `R` ou `Maj+R` en tourne un, et la gomme le retire. L'inspecteur de cellule choisit le personnage de chacun (Chip ou Melinda) ou le retire. Les joueurs supplémentaires suivent chaque modification (gomme, couper, coller, déplacer, redimensionner, annuler), et les réglages du niveau montrent le nombre de joueurs. Un second joueur ne peut pas démarrer sur la case de départ du joueur. Règles Epoxy uniquement.
- **Jeu.** `V` (reconfigurable dans la configuration du jeu) ou le bouton tactile passe au joueur suivant. Le HUD montre le personnage commandé avec son portrait, combien de joueurs restent et combien sont sortis, et un anneau marque le joueur commandé. Les échanges sont annoncés et rejoués ; une solution enregistrée peut contenir un échange (lettre `P`).
- **Import et validateur.** Les packs stockent ces niveaux (format 13) dans une liste `extraPlayers`. L'import CC2 place tous les joueurs (les niveaux CC2 à plusieurs joueurs sont approximatifs au lieu d'être perdus). Le validateur propage depuis chaque départ, signale un joueur qui ne peut pas atteindre une sortie et avertit de deux départs sur une même case.

### 1.14 Éléments CC2 ajoutés au format de pack 14

- **Boue CC2.** Tue tous les monstres sauf le fantôme et la goutte. Un bloc de terre ou un bloc de glace poussé dessus l'efface et survit. Une goutte qui a marché sur la boue la propage. Le rocher n'est pas modélisé.
- **Tortue CC2.** Un nénuphar que les monstres peuvent traverser. Elle arrête les boules de feu et les fantômes, et se change en eau derrière celui qui la quitte (un planeur la laisse à flot).
- **Jet de flammes CC2 et bouton orange.** Le jet brûle celui qui s'y trouve tant qu'il est allumé ; les bottes de feu protègent, et les monstres peuvent y entrer. Un bouton orange bascule le jet auquel il est relié quand on l'enfonce, puis de nouveau quand on le relâche. L'import CC2 place le bouton comme une plaque de pression et le relie au jet que CC2 relierait (le premier jet trouvé par une recherche en losanges croissants autour du bouton, en partant de l'est, dans le sens antihoraire). Deux boutons sur un même jet, ou un bouton et un fil, sont combinés par OU : approximation connue.
- **Sol barrière à blocs.** Le sol escamotable CC2 : le joueur et les monstres le traversent, tous les blocs sont refusés.
- **Bloc fléché en croix.** Le bloc directionnel à quatre flèches. Toute poussée le déplace. Il ne pousse pas encore les autres blocs quand il glisse.
- **Transmogrificateur CC2.** Échange les acteurs selon les paires CC2. La goutte devient un monstre tiré au hasard dans la réserve CC2, avec un générateur à graine. Écarts connus : un char bleu devient un char jaune (Epoxy n'a qu'un char), les objets ne sont pas échangés, et un fil ne le commande pas.
- **Téléporteur aléatoire.** Le socle vert : la destination est tirée parmi les autres socles verts avec un générateur à graine, ce qui garde les rejeux déterministes.
- **Téléporteur rouge CC2.** Le socle rouge avec son propre ordre de sortie. Le fil qui l'éteint et la priorité du joueur sur le socle rouge sont repoussés à plus tard.
- **Casque.** Un objet qui protège son porteur du contact des monstres et des blocs tant qu'il le tient. Il n'arrête pas une boule de bowling.
- **Placement.** Entrées de palette. Sous un panneau interdit, le casque s'importe comme la protection (ward), car il n'existe pas de panneau pour le casque.

## 2. Venus de Chuck's Challenge 3D

La conversion CC3D (le bouton "Convertir en Epoxy", et `npm run import:cc3d` pour des dossiers entiers hors ligne) utilise ces mécanismes à la place d'équivalents approchants, et rapporte la couverture par pack.

### 2.1 Porte des Poissons et téléporteurs

- **Porte des Poissons.** Un socket qui reste fermé tant qu'il reste une puce. Une fois la dernière puce prise, le joueur, un bloc ou un monstre peut y entrer, et le premier à passer la transforme en sol. Nécessite : des puces à ramasser.
- **Téléporteur Avant.** Ne s'enchaîne qu'avec d'autres téléporteurs avant et envoie ce qui entre (joueur, bloc ou monstre) hors du précédent dans l'ordre de lecture, tout droit uniquement.
- **Téléporteur Tournant.** Même chaîne, mais essaie tout droit, puis à droite, puis à gauche, puis demi-tour. Un patin qui contient quelque chose est ignoré.
- **Placement.** Entrées de palette, dans le groupe Téléporteurs. Chacun nécessite un second patin de son espèce. Le socket et les deux téléporteurs sont exacts dans la conversion.

### 2.2 Monstres

Entrées de palette, une par monstre ; `Maj+R` tourne la créature sous le curseur. Les bébés monstres et les jambes pressent les dalles.

| Monstre | Déplacement (d'après sa description) |
|---|---|
| Rebondisseur | Tout droit, fait demi-tour s'il est bloqué ; évite l'eau, le feu, la boue |
| Snappy | Poursuit sur l'axe de plus grande distance, se repose un pas après chaque pas |
| Nibble | Fuit sur l'axe de plus grande distance, se repose un pas après chaque pas |
| Blinky | Tout droit, sinon gauche, droite, demi-tour ; l'eau ne l'arrête pas ; ne presse aucune dalle, n'actionne aucun interrupteur |
| Bébé Blinky | Comme Blinky, mais la glace et les sols de force l'entraînent, et il actionne dalles et interrupteurs |
| Limpy / Limpa | Suivent le mur à leur droite / à leur gauche |
| Omni | Lent, direction aléatoire ; après avoir posé le pied sur de la boue, il en laisse derrière lui |
| Marcheur (CC3D) | Tout droit ; direction aléatoire s'il est bloqué ; avance en quatre ticks |
| Jambes vertes / rouges | Tout droit, sinon droite, gauche, demi-tour / tout droit, sinon gauche, droite, demi-tour |
| Hurleur | Le feu ne l'arrête pas ; fait fondre le bloc de glace sur sa route ; ne presse aucune dalle |
| Bébé hurleur | Comme le Hurleur, mais la glace et les sols de force l'entraînent, et il actionne les dalles |

Les monstres d'origine CC3D tuent au contact.

## 3. Venus d'Epoxy

### 3.1 Dispositifs à signal

Des liaisons de signal pilotent ces dispositifs ; le validateur et la fiche "Comment fonctionnent les mécanismes" les suivent.

- **Mur violet et sol violet.** Basculent à chaque changement du signal qui leur est lié, qu'il commence ou cesse d'émettre (le bouton vert n'y touche pas).
- **Interrupteur.** Une source de signal qui change d'état chaque fois que quelque chose marche dessus (une entrée de palette, `R` choisit éteint ou allumé).
- **Bouton noir.** Une source de signal toujours active, sauf tant que quelque chose se tient dessus.
- **Bouton d'impulsion gris.** Chaque fois que quelque chose marche dessus, il envoie une impulsion à tous les dispositifs à signal situés à deux cases (une zone de 5 x 5) sans liaison depuis le bouton : les tuiles à bascule basculent, les lanceurs et les machines à cloner tirent une fois, les portes de maintien, les patins de relais et les pièges à signal s'ouvrent un instant.
- **Piège mécanique à signal.** Retient ce qui y entre ; s'ouvre tant que son signal est actif ou qu'un bouton brun est maintenu.
- **Jet de flammes à signal.** S'allume à chaque changement de son signal ; le bouton orange n'y touche pas.
- **Placement et liaison.** Entrées de palette. Reliez chaque source à ses dispositifs avec `K` (ou le bouton Relier de la section Connexions). L'import CC2 y convertit ses murs et sols violets, ses interrupteurs, ses boutons noirs, ses boutons gris, ainsi que les pièges et jets de flammes qu'une liaison atteint ; le piège à signal, le jet de flammes à signal et le bouton gris sont rapportés comme approximatifs.

### 3.2 Plusieurs joueurs

Voir la section 1.13 : la règle est celle de CC2, jouée avec les règles Epoxy, et l'éditeur, les commandes de jeu, l'import et le validateur la prennent tous en charge.

### 3.3 Ports des portes dans l'éditeur

- **Lignes de Connexions.** Les lignes d'un verrou de données ou d'un compteur nomment le rôle de chaque liaison : donnée, horloge, comptage +, comptage -, dépassement haut, dépassement bas.
- **Échange de ports.** Un bouton "Échanger les entrées" / "Échanger les sorties" échange les ports du dispositif (annulable).
- **Surcouche.** La surcouche des dispositifs étiquette chaque flèche avec son port (D, CK, +, -, OV, UN).
- **Validateur.** Il avertit d'un verrou de données sans horloge ou sans donnée, et d'un compteur qui ne fait que décompter sans liaison sur sa sortie de dépassement bas.

### 3.4 Familles de variantes dans la palette

Les familles de variantes occupent une entrée chacune : panneaux interdits, compteurs, portes pivotantes, portes pivotantes CC2, interrupteur. `R` fait passer le pinceau d'une variante à l'autre de la famille, l'entrée montre la variante en main, la pipette prend la variante, et la recherche liste toujours chaque variante.

## 4. Tableau récapitulatif

| Mécanisme | Origine | Commande de l'éditeur |
|---|---|---|
| Case de voies, panneau de chemin de fer | CC2 | Groupe Rails, section de l'inspecteur de cellule, `Maj+R` |
| Auvent | CC2 | Pinceau Auvent, onglet Terrain |
| Bloc fléché verrouillé, poussée en chaîne | CC2 | Palette / règle des blocs |
| Dynamite, puce et bombe vertes, mur et feuille d'acier | CC2 | Palette |
| Melinda, chaussures de randonnée, panneaux, transmogrificateur | CC2 | Réglages du niveau (Personnage), palette |
| Panneaux interdits, portes pivotantes CC2 | CC2 | Famille de palette, `R` |
| Horloge à bascule, pot-de-vin, éclair | CC2 | Palette |
| NON-ET, verrou de données, compteur | CC2 | Palette, lignes de Connexions, Échange de ports |
| Mimétique du sol, dents timides, fantôme, rôdeur, joueurs miroirs | CC2 | Palette, `Maj+R` |
| Boue CC2, tortue, jet de flammes et bouton orange, sol barrière à blocs, bloc fléché en croix, transmogrificateur CC2, téléporteurs aléatoire et rouge CC2, casque | CC2 | Palette, `K` pour le bouton orange |
| Porte des Poissons, téléporteurs avant et tournant | CC3D | Palette |
| Rebondisseur, snappy, nibble, famille Blinky, limpy, limpa, omni, marcheur, jambes, famille Hurleur | CC3D | Palette, `Maj+R` |
| Mur et sol violets, interrupteur, bouton noir, bouton d'impulsion gris, piège et jet de flammes à signal | Epoxy | Palette, `K` |
| Plusieurs joueurs | Règle CC2 | Outil Deuxième joueur, inspecteur de cellule, `R` / `Maj+R`, `V` pour échanger en jeu |
