# EPOXY - Jeu de logique sur grille

*English version: [README.md](./README.md)*

**Jouer en ligne :** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** est un jeu de puzzle à tuiles pour navigateur, dans l'esprit des jeux de réflexion portables de l'époque Atari Lynx, écrit en TypeScript avec HTML5 Canvas et la Web Audio API.

## Fonctionnalités

- **Des centaines de niveaux inclus** :
  - **Campagne Epoxy** : 30 niveaux écrits à la main, répartis en chapitres (définis dans `public/configs/campaign.json`), chacun construit autour d'une idée et prouvé solvable en rejouant sa solution enregistrée dans le moteur du jeu. Ils enseignent une mécanique par niveau, des puces, clés et bottes jusqu'aux pièges, cloneurs, créatures, voleurs, barrières d'objets, tortues et jets de flammes, et chaque chapitre se termine par un niveau qui les combine. Un test d'originalité garde chaque carte différente des niveaux communautaires fournis. La fenêtre des niveaux présente la campagne par chapitre, chacun repliable, avec une barre de progression et une bande de vue d'ensemble qui mène à un chapitre, et le titre d'un chapitre s'affiche au début de son premier niveau.
  - **Packs communautaires fournis** : `Tile World Intro` et `CCLP 1` à `CCLP 5` (voir [Crédits](#crédits)).
  - **Packs communautaires aux règles de la console d'origine** : les packs communautaires fournis (sauf CCLP 2) et les fichiers `.DAT` importés se jouent avec les règles de la console portable d'origine (Lynx), sur un moteur dédié. L'aide, le déplacement par toucher, le repère d'objectif, la relecture de solution, le dépôt d'objets et la surveillance d'impasse n'y sont pas disponibles. Le champ `Règles` de l'éditeur fait passer un niveau des règles Epoxy aux règles Lynx, et inversement.
  - **Niveaux Chuck's Challenge 3D** : le bouton d'import accepte aussi les fichiers de niveaux `.xml` de Chuck's Challenge 3D. Choisissez-en un ou plusieurs à la fois : ils forment un seul pack, joué sur leur propre moteur de règles (`src/core/cc3d/`), à côté du moteur Lynx. Un fichier illisible est refusé avec un message qui en donne la raison. Les niveaux ne sont pas inclus dans Epoxy : ils doivent venir de vous, et ils restent dans votre navigateur comme les autres packs importés. Ils s'ouvrent dans l'éditeur de niveaux (voir [Vos packs et l'éditeur de niveaux](#vos-packs-et-léditeur-de-niveaux)). L'aide, le déplacement par toucher, le repère d'objectif, la relecture de solution, le dépôt d'objets et la surveillance d'impasse n'y sont pas disponibles.
  - **Formats `.DAT` / `.CCL` / `.JSON`** : import et export par glisser-déposer de packs au format binaire CC1 `.DAT`, très répandu. Les packs que vous possédez s'importent de cette façon. Un fichier de plus de `import.maxFileBytes` (4 Mio) est refusé avant d'être lu. À l'export, un niveau plus petit que le format 32x32 est fermé par des murs, et un niveau qui n'y tient pas est écarté avec un message au lieu d'être écrit faux. L'auteur d'un niveau, stocké dans un pack (champ 9), s'affiche à côté du titre et se conserve à l'export, et l'éditeur a un champ Auteur. Un bouton "Supprimer les packs importés", à côté du bouton d'import, retire tous les packs importés d'un coup, après confirmation ; les packs fournis et vos propres packs sont conservés. Un pack exporté en JSON depuis "Mes packs" conserve tous les moteurs et se réimporte sous son nom (voir [Vos packs et l'éditeur de niveaux](#vos-packs-et-léditeur-de-niveaux)).
  - **Collections Sokoban (`.xsb` / `.sok`)** : déposez une collection sur le jeu et chaque niveau se joue comme du Sokoban : il est gagné dès que chaque cible porte un bloc, sans sortie à atteindre. Les rangées compressées (`4#`) sont développées, l'extérieur de la salle devient mur, et un niveau que le fichier abîme (pas de joueur, pas de cible, moins de caisses que de cibles, salle ouverte sur le bord) est écarté avec un décompte. Les packs que vous possédez restent dans votre navigateur, comme les packs `.DAT` importés. Dans l'éditeur, tout niveau peut suivre cette règle (champ `Règle de victoire`, tuile `block_target`) ; un tel niveau ne s'exporte pas en `.DAT`. Le bouton Aide joue la poussée suivante et la surveillance d'impasse couvre ces niveaux, jusqu'à `blockPuzzle.watchMaxCells` cases. Les niveaux Sokoban sont dessinés automatiquement avec les sprites du pack Sokoban de Kenney (sol pavé, murs de briques, marques de cible, caisses en bois), quel que soit le style graphique choisi, tandis que le joueur garde le sprite du style ; un bouton à côté de celui du LCD dans Options > Avancé désactive cet habillage (activé par défaut, mémorisé).
  - **Niveaux de toute taille** : un niveau `.json` ou un pack personnalisé fixe sa propre largeur et sa propre hauteur, de la pièce de 10x10 au niveau de 40x40 ou 100x100 (`grid.minLevelSize` à `grid.maxLevelSize` dans `game.json`) ; la caméra et l'éditeur suivent le niveau. Le format `.DAT` et le générateur procédural gardent le 32x32 classique (`grid.mapWidth` / `grid.mapHeight`).
  - **Générateur procédural prouvé** : assemble les niveaux à partir de pièces d'énigme dessinées à la main (`public/configs/motifs.json`), chacune prouvée équitable et solvable par un solveur qui fait tourner le vrai moteur du jeu. Chaque niveau généré est ensuite rejoué du début à la fin avant d'être proposé : il est toujours solvable et aucune énigme ne peut être contournée. Difficulté, thème et rythme progressent avec le numéro du niveau. À partir du niveau 3, les niveaux sont des hubs aux ailes verrouillées dont les clés et les bottes se trouvent dans d'autres ailes ; la forme du hub (`procedural.hub.shapes` dans `game.json`) et les salles récompense varient, et avec le biome sur Auto chaque niveau prend l'ambiance de sa mécanique principale. Les niveaux sont disposés de façon compacte, avec peu de culs-de-sac, et deux niveaux voisins d'un pack ne partagent ni leur mécanique principale ni la forme de leur hub. Chaque pack vient d'une graine : **Mode infini** (ou `N`) en demande une (vide pour une graine aléatoire) ainsi que le niveau de départ, et la graine du pack en cours s'affiche à côté du sélecteur de pack avec un bouton Copier.
  - **Mode infini** : vise dès son premier niveau la difficulté des packs communautaires. Le niveau 1 est déjà un hub chronométré de 7 pièces difficiles (jusqu'au palier 5), qui monte à 10 pièces et 6 mécaniques (`procedural.endless` dans `game.json`). Seul le niveau joué est construit ; le suivant est préparé à l'avance dans un Web Worker, et la boîte de dialogue retient la graine et le niveau le plus loin atteint pour reprendre une partie. Le pack ne se termine jamais ; une partie peut commencer à n'importe quel niveau jusqu'à `endlessUi.maxStartLevel` (10000), et `src/generator/EndlessFingerprint.test.ts` vérifie qu'une graine construit toujours les mêmes niveaux. Les ailes d'un hub peuvent être des chaînes d'énigmes qui reviennent au hub par une bande de sol directionnel à sens unique (`hub.returnGate`), ce qui permet des pièces irréversibles et supprime le chemin de retour à pied. Les clés sont rares (`hub.scarceGates`) : une couleur de porte peut garder deux ailes alors qu'une seule clé est accessible au départ, donc l'ordre d'ouverture des ailes compte et la mauvaise porte oblige à recommencer le niveau. Les monstres sont présents dans la plupart des niveaux (`procedural.endless.motifShares`). La zone ouverte du hub est du contenu, pas du sol nu : 1 à 3 monstres qui suivent des lignes fixes (`hub.openMonsters`), 4 à 9 puces dispersées comme points de passage, une de plus par tranche de cellules de la zone (`hub.openChips`) et des taches de feu ou d'eau (`hub.openHazards`), avec des bandes de gravier qui tiennent les monstres hors des ailes ; le prouveur parcourt cette zone par une recherche temporisée. La zone grandit avec la surface que les énigmes laissent libre : le contour du hub gagne des rangées et des colonnes de sol avant le placement des ailes (`hub.outlineGrowth`), donc un niveau aux énigmes moins nombreuses ou plus petites a un hub plus grand ; la recherche de zone du prouveur vise sa cible au meilleur d'abord, donc le coût de la preuve suit le chemin et non le sol ; `npm run report:hub` mesure où va la surface de la carte. Des règles de densité gardent les énigmes équitables : `minBoxCellsPerMonster` donne de la place à chaque monstre et `maxMonstersPerLevel` plafonne le niveau. Les énigmes dépendent les unes des autres (`hub.dependencies`) : une pièce exporte un bloc de terre poussé hors de sa sortie, que l'on pousse le long d'un couloir rectiligne jusqu'à la pièce suivante, où il comble l'eau qui la verrouille ; ou une pièce exporte une clé que seule une porte d'une autre aile accepte, ce qui impose l'ordre de visite des ailes. Les paires sont déclarées dans les pièces elles-mêmes (`exports` et `imports` dans `motifs.json`), appariées par le planificateur de hub dans les hubs à ailes en boucle uniquement, et le niveau entier est rejoué avec le bloc poussé et la clé portée. La bibliothèque compte 159 pièces (avec une fenêtre de non-répétition `avoidPiecesFor` en mode infini), dont des arènes de monstres, des réseaux de téléporteurs, des séquences de murs à bascule, des machines à cloner, des énigmes de terre compactée (motif `dirt`), les mécaniques de Chip's Challenge 2 (alchimie `ice_block`, sas à jets de flammes `button_orange`, téléporteurs de couleur, barrières `forbid_*` avec `thief_keys`, `recessed_wall`, ponts de tortues `turtle`, neutralisation de `slime`, inversion puces/bombes `button_gray`), et les pièces exportatrices et consommatrices de ces paires (pour `dirt_block` comme pour `ice_block`). `npm run report:levels` mesure ce mode face aux packs communautaires, `npm run report:dependencies` mesure la part des niveaux qui tiennent une paire de dépendance, et `src/generator/EndlessGuard.test.ts` maintient sa largeur, ses embranchements, ses retours en arrière, la présence de monstres, la part du sol ouvert proche d'un contenu, le nombre de pièces et le temps de génération au-dessus de seuils fixés. Dans les énigmes de blocs, le bouton Aide joue la poussée suivante, et le jeu signale une impasse dès qu'elle est prouvée (budgets de recherche sous `blockPuzzle` dans `game.json` : un petit pour la surveillance automatique, un plus grand pour le bouton Aide).
  - **Solution** (`O`) : chaque niveau de la campagne et chaque niveau généré conserve la solution rejouée par sa preuve. Le bouton recommence le niveau et joue cette solution jusqu'à la sortie ; la regarder n'enregistre aucun score.
- **Moteur complet de tuiles et de monstres** :
  - Dangers élémentaires (`water`, `fire`, `ice` avec déflecteurs d'angle, convoyeurs `force` qui emportent le joueur, les blocs et les monstres, `bomb`, `slime` neutralisé en sol par tout bloc).
  - Mécanismes interactifs (`button_green`, machines à cloner `button_red`, pièges `button_brown`, inverseurs de tanks `button_blue`, inversion puces/bombes 5x5 `button_gray`, téléporteurs `teleport`, `thief`).
  - Dépôt d'objets : `E` pose la clé ou les bottes sélectionnées sur la case courante, `C` sélectionne l'objet suivant, et un clic sur une case de l'inventaire dépose cet objet. Le ramassage n'a lieu qu'en entrant sur une case : un objet déposé y reste jusqu'à ce que vous reveniez le chercher.
  - Barrières à objet interdit (`forbid_key_red`, `forbid_boots_fire`, ...) : la case vous refuse tant que vous portez l'objet, et redevient du sol une fois l'objet déposé ailleurs. Un voleur de clés (`thief_keys`) prend toutes les clés, comme le voleur d'équipement prend les bottes.
  - Les tortues (`turtle`) coulent dans l'eau une fois que le joueur ou un bloc les a quittées : un pont de tortues ne se traverse qu'une fois.
  - Les quinze combinaisons de parois fines (`thin_wall_ns`, `thin_wall_nesw`, ...), des téléporteurs de couleur qui ne s'enchaînent qu'avec leur propre couleur (`teleport_red` à `teleport_green`), des jets de flammes commandés par `button_orange` (`flame_jet_off` / `flame_jet_on`, les bottes ignifugées protègent), et des objets bonus : fanions de score (`score_10`, `score_100`, `score_1000` s'ajoutent au score du niveau payé à la sortie ; `score_2x` double ce score de niveau, fanions compris) et chronomètres (`stopwatch_bonus` ajoute 10 secondes, `stopwatch_penalty` en retire 10). Les bottes qui vous protègent sur votre case courante ne peuvent pas y être déposées.
  - 9 comportements de créatures (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
  - Lasers (règles Epoxy uniquement) : les émetteurs (`laser_emitter_n` à `laser_emitter_w`) projettent un rayon en ligne droite qui tue le joueur et les monstres ; les miroirs poussables (`mirror_slash`, `mirror_backslash`) le dévient de 90 degrés et refusent l'eau ; les récepteurs (`laser_receiver_red`, `laser_receiver_blue`) tiennent ouvertes les portes laser de leur couleur tant qu'ils sont allumés (`laser_gate_red_closed` / `_open`, de même pour le bleu). Un niveau peut se gagner en allumant tous les récepteurs (règle de victoire `receivers`). Chaque case déclare si le rayon la traverse (`laserTransparent` dans `tiles.json`). Les niveaux Lynx et l'export DAT refusent le contenu laser.
- **Rendu et commandes** :
  - Un habillage de personnage facultatif (Options > Avancé > Personnage : Standard ou Julien) redessine le joueur dans tous les styles graphiques ; Standard est le choix par défaut et il est mémorisé.
  - Moteurs de rendu HD Neon, Retro 16 bits et Retro 32 bits (choisis dans Options > Essentiel, ou en boucle avec `G`) avec 4 thèmes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`) : les murs se raccordent en masses continues qui projettent des ombres douces, les sources de lumière éclairent la scène en HD Neon, le Retro 16 bits dessine chaque tuile et chaque personnage en sprite de 16x16 dans une palette de console 9 bits (avec une grille LCD optionnelle), le Retro 32 bits utilise des sprites de 32x32 ombrés en couleur 15 bits (l'éclairage et le reflet sont dessinés par-dessus), et le joueur comme chaque monstre sont animés. Un réglage de qualité graphique (Auto par défaut) garde le jeu fluide sur les appareils plus lents.
  - Cinq styles Retro HD (Pocket 4 tons, Pastel, Blueprint, Sepia et Classic 90s) dessinent la même scène en pleine résolution que HD Neon, avec leur propre palette, des aplats de couleur à la place des dégradés, sans halo lumineux et avec une texture légère par-dessus (grille de points, quadrillage, grain de papier, lignes de balayage). Le feu, l'eau, la glace, les pièges, les monstres, les clés et les portes gardent chacun leur famille de couleur dans tous ces styles, et restent faciles à distinguer.
  - **Indice** (`H`) : localisateur d'objectif et affichage des câblages de mécanismes ; survoler un téléporteur de couleur montre son propre réseau, et survoler un bouton orange montre les jets de flammes qu'il commande.
  - Glyphes pour daltoniens sur les portes, clés, boutons et téléporteurs de couleur.
  - Mouvement réduit : quand le réglage système est actif, le saut, le flottement, les reflets, le scintillement, les clignotements, les particules et la secousse d'écran s'arrêtent, et un changement du réglage est suivi en direct.
  - Clavier : `Tab` déplace le focus entre les commandes, les raccourcis Ctrl/Cmd sont laissés au navigateur sauf l'annulation (Ctrl/Cmd+Z), qui suit la disposition du clavier (AZERTY, QWERTY, cyrillique...), et `?` ouvre l'aide.
  - Support tactile complet sur smartphone (joystick virtuel par glissement, déplacement par toucher, croix directionnelle avec retour haptique ; le zoom se règle dans les options). Le plateau montre toujours la vue choisie en carré de N x N cases : un écran large ou en paysage ne dévoile pas plus du niveau qu'un écran carré.
  - Éditeur de niveaux complet avec validation en direct par le solveur, et vos propres packs de niveaux (voir [Vos packs et l'éditeur de niveaux](#vos-packs-et-léditeur-de-niveaux)).
- **Musique** : sept pistes originales de Julien Bombled (voir [Crédits](#crédits)), avec trois modes, choisis dans Options > Avancé (l'activation du son reste dans Options > Essentiel). **Défaut** suit le biome affiché (chaque biome nomme sa piste avec `musicTrackId` dans `game.json`). **Aléatoire** tire une nouvelle piste à chaque nouveau niveau, sans jamais répéter la précédente tant qu'il existe au moins deux pistes. **Personnalisé** fait de même parmi les pistes que vous cochez (une au moins reste cochée). Un redémarrage, une nouvelle tentative après une mort ou un retour au premier niveau d'un pack d'un seul niveau ne change pas la piste, et en mode Aléatoire ou Personnalisé le biome (et la touche `B`) ne change plus la musique. Le mode et les pistes cochées sont enregistrés.
  - Le jeu livre sept pistes originales : `Odyssée 8 bits` pour Cyber Neon, `Pulsation souterraine I` pour Arctic Lab et `Pulsation souterraine III` pour Magma Core (`Pulsation souterraine IV` ne joue qu'en mode Aléatoire et Personnalisé). Retro Lynx LCD joue `Pulsation souterraine II`. Ces sept pistes sont la seule musique : plus rien n'est synthétisé.
  - Volume : deux curseurs dans Options > Essentiel, "Volume des effets" et "Volume de la musique", de 0 à 100 % par pas de 5, chacun affiché tant que son son est activé. 100 % correspond au volume réglé dans `audio.json` ; le curseur de la musique agit tout de suite sur la piste en cours. Les deux valeurs sont enregistrées.
  - En mode Défaut, les niveaux d'une partie infinie jouent `Mode infini I` ou `Mode infini II` à la place de la piste du biome : un nouveau niveau ne rejoue jamais la piste du niveau précédent. La liste est `endlessUi.musicTrackIds` dans `game.json`. Aléatoire et Personnalisé ne changent pas.
- **Effets sonores** : la plupart des effets jouent des fichiers audio CC0 fournis (voir [Crédits](#crédits)), le son synthétisé servant de repli tant qu'un fichier n'est pas décodé ou s'il échoue. Les pas dépendent du terrain sur lequel le joueur avance (sol, sol à convoyeur, glace, et eau ou feu avec les bottes protectrices), associé par `terrainStepEffects` dans `audio.json`. Avec les règles Lynx, seul un pas choisi par le joueur fait du bruit.

## Vos packs et l'éditeur de niveaux

- **Mes packs** : le bouton "Mes packs" de l'en-tête (aussi dans le tiroir, la boîte Niveaux et le "Ouvrir..." de l'éditeur) liste vos packs. Créez et renommez des packs, puis jouez-les, exportez-les ou supprimez-les. Les niveaux sont stockés dans votre navigateur (IndexedDB).
- **Par niveau** : réordonner, modifier, jouer, dupliquer, copier ou déplacer vers un autre pack, supprimer. Des badges indiquent le moteur de chaque niveau (Epoxy, Lynx, CC3D, Sokoban). Les niveaux CC3D peuvent être gérés et modifiés.
- **Export** : un fichier JSON complet qui conserve tous les moteurs, ou un fichier `.CCL`. Un JSON exporté ainsi se réimporte sous son nom.
- **Supprimer un pack** : demande une confirmation avec le nombre de niveaux, et propose "Exporter d'abord". "Supprimer les packs importés" ne touche jamais vos propres packs.
- **Miniatures et ordre** : chaque niveau et chaque pack affiche un petit plan. Faites glisser un niveau par sa poignée pour le déplacer (souris ou tactile ; `Échap` annule), ou utilisez les boutons flèches ou les flèches du clavier sur la poignée.
- **Auteur et description** : chaque pack peut porter un auteur et une description, modifiés dans l'en-tête du pack et conservés dans l'export JSON.
- **Partager un pack par un lien** : "Copier le lien de partage" place tout le pack dans le lien lui-même, après le `#`, qui n'est donc jamais envoyé à un serveur. Qui l'ouvre voit un aperçu (nom, auteur, niveaux, moteurs, miniatures) et choisit Importer, Importer et jouer ou Annuler ; rien n'est stocké avant. Un pack déjà importé depuis le même lien est reconnu. Un lien est limité à `share.maxLinkChars` caractères (quelques niveaux) ; exportez le fichier JSON pour un pack plus gros, car un lien long ne passe pas dans toutes les messageries.
- **Identifiants des niveaux importés** : les niveaux d'un fichier importé reçoivent des identifiants propres à leur pack ; importer deux fois le même fichier, ou un fichier nommé comme un pack fourni, ne mélange plus leurs records. Les doublons déjà stockés sont renommés une fois au chargement ; la première copie garde ses records.
- **Vos anciens niveaux Custom** ont été déplacés automatiquement dans un pack à vous ("Mes niveaux") ; il n'y a rien à faire.
- **Disposition** : palette, canevas et réglages du niveau sont sur trois colonnes sur grand écran, deux sur écran moyen et une sur écran étroit, où la palette devient une bande horizontale. Le canevas est mis à l'échelle de la fenêtre ; zoomez avec `-`, `+` ou les boutons de zoom, et `0` ou "Ajuster" pour réajuster. Un zoom garde en place la case pointée, le curseur clavier fait défiler une grande carte, et annuler ou rétablir montre où le changement a eu lieu et dit ce qu'il était.
- **Outils** : Pinceau (`B`), Remplissage (`F`), Gomme (`E`) et Pipette (`I` ; Alt+clic ou clic du milieu pipette aussi). `R` fait pivoter l'orientation de la créature ou du départ sélectionné, et `Échap` annule un lien qui attend sa cible.
- **Sans souris** : donnez le focus au canevas, déplacez le curseur avec les flèches et peignez avec `Espace` ou `Entrée`.
- **Pastille de vérification** : indique Valide, le nombre d'avertissements ou le nombre d'erreurs du niveau.
- **Récupération de brouillon** : tant qu'un niveau a des modifications non enregistrées, l'éditeur en garde un brouillon dans votre navigateur (écrit un instant après la dernière modification, et quand la page est masquée). Après un plantage ou un onglet fermé, la visite suivante propose de le restaurer, de l'abandonner ou de décider plus tard ; restaurer par-dessus un niveau enregistré garde l'annulation vers la version enregistrée, et un avertissement signale que le niveau a changé dans son pack entre-temps. Un brouillon de plus de `1 000 000` caractères est ignoré, avec un message. Chaque onglet garde son propre brouillon : deux onglets ouverts ne s'écrasent jamais, et les brouillons des onglets fermés sont proposés un par un, du plus récent au plus ancien.
- **Réglages du niveau** en sections : Niveau, Règles (avec le moteur), Taille (redimensionner un niveau) et Générer. Sous les règles Lynx, les éléments de la palette réservés à Epoxy sont désactivés, avec un "Passer ce niveau en Epoxy" en un clic. Annuler et rétablir couvrent aussi les réglages et le moteur, et la marque de modifications non enregistrées disparaît quand on annule jusqu'à l'état enregistré.
- **Nouveau** : partez d'une salle vide, d'une salle CC3D vide, d'une salle de Sokoban ou d'un puzzle laser (modèles dans `public/configs/templates.json`, Epoxy uniquement ; un pack surtout fait de niveaux Lynx propose les salles vides).
- **Niveaux CC3D** : ils s'ouvrent dans le même éditeur, avec leur propre palette (Sols, Dispositifs, Obstacles, Objets, Créatures, Joueur ; choix de couleur, de coin et de miroir ; le contrôle de direction fixe les orientations). La gomme retire l'élément le plus haut d'une case (créature, puis objet, puis couche du haut) et `Maj`+gomme vide toute la case. Avec l'entrée cloison fine choisie, un clic bascule le côté de la case le plus proche du pointeur (au clavier, le côté du contrôle de direction). Survoler un dispositif, ou y placer le curseur, dessine ses liens (contrôle de piège vers piège, téléporteur, interrupteur de clonage vers machine et modèle, contrôleur laser vers tireur, groupes de même couleur), et la ligne d'état signale une modification qui change un lien. L'inspecteur liste les couches de la case du curseur, chacune avec un bouton pour la retirer ; le moteur est en lecture seule et les champs règle de victoire et puces s'effacent (les puces sont les poissons de la carte). Le remplissage remplace une entrée de couche sur toute une région, limitée par les cloisons fines ; la sélection copie, coupe, colle et déplace des rectangles (les créatures gardent leur ordre, et les liens qui changent sont signalés) ; le redimensionnement garde le coin en haut à gauche. Un bouton Exporter XML écrit le niveau dans le format XML propre à Chuck's Challenge 3D, et Importer rouvre un tel fichier `.xml` ; l'export CCL est refusé pour les niveaux CC3D. Enregistrer un niveau CC3D qui comporte des erreurs demande d'abord confirmation.
- **Sélection** (`S`) : glissez pour sélectionner, `Maj`+flèches pour étendre, `Ctrl` (`Cmd`) + `C` / `X` / `V` pour copier, couper et coller (un aperçu suit le pointeur ; un clic ou `Entrée` le pose), `Suppr` pour effacer, `Alt`+flèches ou un glisser dans la sélection pour la déplacer. Le départ du joueur n'est jamais dupliqué, les liens suivent la sélection quand leurs deux bouts y sont, et coller ou déplacer ne touche jamais l'anneau de murs extérieur.
- **Tester d'ici** (`T` ou le bouton à côté de Tester) : joue le niveau avec le joueur sur la case du curseur ; le niveau modifié ne change pas.
- **Ligne Blocs de Vérifier** : pour un pur puzzle de blocs (règle "couvrir chaque cible", uniquement sol, murs, cibles, puces et blocs, une zone jouable d'au plus `blockPuzzle.watchMaxCells` cases), Vérifier indique aussi "résolu en N poussées", "impossible de couvrir chaque cible" ou "non vérifié". La recherche tourne en arrière-plan et s'arrête quand vous modifiez le niveau. Elle n'affirme jamais qu'un niveau entier peut être gagné.
- **Où vous en êtes** : l'éditeur affiche le pack et le niveau modifiés (Pack, Niveau n/N) avec des boutons précédent et suivant.
- **Enregistrement** : Enregistrer met à jour le niveau dans son pack, aussi avec Ctrl+S. Un niveau d'un pack fourni, un niveau généré ou un fichier ouvert dans l'éditeur s'enregistre avec "Enregistrer dans..." : choisissez un pack, ou créez-en un dans la même étape. "Enregistrer une copie..." enregistre un autre niveau et garde l'original. Le premier enregistrement dans un pack importé demande s'il faut le modifier ou enregistrer une copie. Enregistrer ne change jamais le pack que vous êtes en train de jouer.
- **Test** : "Retour à l'éditeur" revient d'un essai de jeu, et le navigateur demande confirmation avant de fermer l'onglet avec un travail non enregistré.
- **Validateur** : de nouveaux avertissements pour les liens de pièges et de clonage cassés, et pour un départ du joueur sur un mur ou sur un monstre.

## Playtest

Les testeurs peuvent activer le mode playtest dans Options > Avancé : il enregistre la façon dont chaque niveau est joué, sur l'appareil uniquement, et exporte un fichier que le testeur choisit d'envoyer. Voir le [guide du testeur](./docs/fr/playtest.md) ([English version](./docs/playtest.md)).

## Développement

Nécessite Node.js 24 (voir `.nvmrc`).

```bash
npm install
npm run dev
```

### Ajouter des pistes musicales

Les pistes se déclarent dans `public/configs/audio.json`, sous `tracks`. Une piste est lue depuis des fichiers audio (`"source": "file"`) :

```json
{
  "id": "my_track",
  "i18nKey": "app.music.my_track.label",
  "source": "file",
  "files": ["my_track.ogg", "my_track.mp3"],
  "gain": 0.8
}
```

- Placez les fichiers dans `public/audio/music/` (ce dossier est `musicBaseUrl`). Le navigateur joue le premier fichier de `files` qu'il sait décoder ; l'extension doit avoir un type MIME dans `fileMimeTypes` (`ogg` et `mp3` par défaut). `gain` règle la piste par rapport au volume de la musique (1 si omis).
- Ajoutez le nom de la piste dans `src/locales/en.json` et `src/locales/fr.json`, sous `app.music.my_track.label`.
- Associez-la à un biome avec `"musicTrackId": "my_track"` sur le thème dans `game.json`. Chaque piste participe aussi aux modes Aléatoire et Personnalisé.
- Une piste de fichier qui ne se lit pas est ignorée jusqu'à la réactivation de la musique. Quand plus aucune piste ne peut jouer, la musique reste muette : il n'y a pas de morceau de repli.
- Le chargement vérifie la configuration : un identifiant en double, une piste qui n'est pas une piste de fichier ou sans fichiers, un `musicTrackId` inconnu ou un `defaultMusicMode` inconnu arrêtent le jeu avec un message clair.

### Ajouter des effets sonores

Chaque effet se déclare dans `public/configs/audio.json`, sous `effects.<id>`. Un effet est synthétisé à partir de `waveform` et `notes`, et peut aussi jouer des fichiers audio :

```json
"teleport": {
  "files": ["sfx_movement_portal5.wav"],
  "maxDurationMs": 400,
  "fadeOutMs": 150,
  "gain": 0.4,
  "waveform": "sawtooth",
  "notes": [
    { "freq": 330, "durationMs": 35, "gain": 0.4 },
    { "freq": 495, "durationMs": 35, "gain": 0.4 },
    { "freq": 742, "durationMs": 45, "gain": 0.45 },
    { "freq": 1113, "durationMs": 60, "gain": 0.4 }
  ]
}
```

- Placez les fichiers dans `public/audio/sfx/` (ce dossier est `sfxBaseUrl`, `./audio/sfx` si omis) et listez leurs noms dans `files`. Avec plusieurs fichiers, ils jouent à tour de rôle : le pas alterne ainsi entre ses bruits de pas. Un fichier qui ne se charge pas ou ne se décode pas est ignoré.
- `gain` (1 si omis) règle le volume par rapport au volume général multiplié par le volume des effets ; les fichiers fournis utilisent 0,4, sauf `blocked` (0,25) et les pas (de 0,2 à 0,45, calibrés pour que les enregistrements Kenney, plus faibles, sonnent environ moitié moins fort que les autres effets).
- `minIntervalMs` (aucune limite si omis) ignore un appel survenant moins longtemps que cela après le dernier départ du même effet, sur l'horloge audio ; `blocked` est livré à 250 pour que maintenir une touche contre un mur ne mitraille pas le son.
- `maxDurationMs` arrête la lecture à cet instant. `fadeOutMs` ajoute un fondu linéaire qui se termine à cette limite ; il exige `maxDurationMs` et ne peut pas le dépasser.
- `waveform` et `notes` restent obligatoires : ils servent de repli, joués tant qu'aucun fichier n'est décodé (les tout premiers sons après le déverrouillage de l'audio) ou quand un fichier manque ou échoue.
- 17 des 19 effets utilisent des fichiers ; `splash` et `burn` restent synthétisés.
- `terrainStepEffects` associe un terrain à l'identifiant de l'effet joué pour un pas dessus. La clé est le `slideType` ou le `hazard` de la tuile (`force`, `ice`, `water`, `fire`) ; toute autre tuile, ainsi qu'un terrain sans entrée ou dont l'effet n'existe pas, joue `step`. L'eau et le feu ne comptent que si le joueur porte les bottes qui protègent ; sans elles la tuile garde le pas normal et le son de plouf ou de brûlure suit de lui-même. Un sol de force compte même quand les bottes annulent sa poussée.
- Les versions de Safari qui ne savent pas décoder l'Ogg Vorbis ne peuvent pas lire les fichiers de pas et se replient sur le pas synthétisé.
- `teleport` (limite de 400 ms, fondu de 150 ms), `thief` (limite de 500 ms, fondu de 150 ms) et les pas (`step` et `step_fire` limite de 120 ms et fondu de 30 ms, `step_force` et `step_ice` 150 ms et 50 ms, `step_water` 180 ms et 60 ms) utilisent une limite et un fondu.

## Construire une campagne avec le générateur

1. Ouvrez l'**Éditeur de niveaux**, choisissez une **Difficulté**, laissez la **Graine** vide et cliquez sur **Générer**. La graine utilisée s'affiche, ce qui permet de régénérer le même niveau.
2. Retouchez le niveau, puis **testez**-le.
3. **Exportez en JSON** et collez l'objet exporté dans le tableau `levels` de `public/configs/levels.json`. Un niveau exporté se charge tel quel ; ajustez `number` selon la position voulue.

Un niveau `.json` est un plan : `terrain` (une grille d'identifiants de tuiles) ou `rows` (des chaînes de légende, voir `legend` dans `levels.json`) donne sa taille au niveau, donc des lignes de 40 caractères font un niveau de 40 de large ; un plan sans l'un ni l'autre prend le 32x32 par défaut. Le départ du joueur, les entités et les liens doivent se trouver dans cette taille.

La difficulté du générateur découle d'un profil (`src/generator/DifficultyProfile.ts`) : `profileFor('pack' | 'endless', levelNumber, cfg)` donne le nombre de pièces, le nombre de mécaniques, le palier maximal, la disposition, le chronomètre et la longueur visée. Les packs suivent la courbe d'apprentissage de `procedural` ; le mode infini suit `procedural.endless`. La campagne et le mode pack ne changent pas avec le mode infini.

La campagne Epoxy est écrite à la main dans `public/configs/levels.json`. La solution de chaque niveau est décrite comme une route dans `tools/campaign-routes.json` : des coups explicites (`N`, `E`, `S`, `W`, `.` pour attendre) pour les poussées et le timing, et des étapes `@x,y` qui marchent jusqu'à une case par un chemin trouvé par une recherche dans le vrai moteur. `npm run route:campaign` déroule les routes et écrit chaque solution dans `levels.json` (`EPOXY_ROUTE_LEVEL=<id>` pour un seul niveau). `npm test` rejoue chaque solution, vérifie que la sortie reste hors d'atteinte sans chaque objet listé sous `requires`, et contrôle les chapitres de `public/configs/campaign.json` (chaque niveau dans un seul chapitre, titres dans les deux langues) et le rythme décrit dans `tools/campaign-rhythm.json` : niveau où chaque tuile, objet ou entité apparaît pour la première fois, et marges de chronomètre. Pour comparer la campagne à un pack de référence que vous possédez, lancez `EPOXY_REFERENCE_DAT=<chemin> npm run report:originality` ; les paires les plus proches vont dans `local/originality.md`, jamais versionné. `npm test` vérifie aussi que chaque niveau de la campagne ressemble peu aux autres grâce à une empreinte de salle (les cases ouvertes, les blocs et les cibles de la salle ; les murs ne font que la délimiter ; toute rotation, réflexion et translation), avec le seuil `maxRoomSimilarity` dans `campaignGuard` de `game.json`. `maxSokobanSimilarity`, dans la même section, ne s'applique qu'à la vérification `EPOXY_REFERENCE_XSB` ci-dessous. Les collections Sokoban classiques ne peuvent pas être embarquées ; pour comparer les salles de la campagne qui ont des cibles à une collection que vous possédez, définissez `EPOXY_REFERENCE_XSB=<fichier .xsb/.sok/.txt ou dossier>` : le test de `CampaignRoomOriginality.test.ts`, ignoré sinon, s'exécute alors, et `npm run report:originality` écrit les correspondances les plus proches dans `local/originality-sokoban.md`, jamais versionné non plus.

Le pack pilote Epoxy est un second pack intégré qui sert à essayer une campagne reconstruite avec de nouveaux joueurs, sans toucher à la campagne actuelle ni à la progression. Ses niveaux sont dans `public/configs/pilot-levels.json` (ids en `epoxy_p_`), ses chapitres dans `public/configs/pilot-campaign.json`, ses routes dans `tools/pilot-routes.json` et son rythme dans `tools/pilot-rhythm.json`. Il n'apparaît dans le sélecteur de pack et dans la boîte Niveaux que lorsque le mode playtest est activé ; le désactiver pendant qu'on y joue ramène à la campagne. `npm run route:pilot` déroule ses routes (le même outil que `route:campaign`, aussi accessible avec `EPOXY_ROUTE_PACK=pilot`), `npm run report:difficulty:pilot` le mesure, et `npm test` applique les mêmes contrôles de conception et d'originalité qu'à la campagne. Un niveau pilote qui refait volontairement un ancien porte `"reworkOf": "<id de l'ancien niveau>"`, ce qui exempte exactement cette paire de la comparaison de salle avec la campagne ; retirez-le quand le niveau a assez changé pour passer la comparaison sans lui (le test épingle la similarité). Le pilote garde son propre point de reprise : y jouer ne déplace jamais celui de la campagne. Le chapitre 2 (niveaux 16 à 20) enseigne à pousser des blocs ; un niveau pilote avec des blocs peut déclarer `"blockBudget": { "waters": n, "targets": m }`, une note de conception qui dit que le niveau contient exactement n + m blocs (les eaux à combler plus les cibles à couvrir, aucun en trop), vérifiée par les tests.

Les nouvelles pièces d'énigme se placent dans `public/configs/motifs.json` ; lancez ensuite `npm run annotate:pieces` pour précalculer la solution et la réversibilité de chaque pièce dans `public/configs/motif-annotations.json`, que le générateur lit au lieu de chercher dans le navigateur.

Salles Sokoban : `npm run forge:sokoban` en fabrique d'originales en partant de leur solution (des blocs sur des boutons marron qui maintiennent ouverts les pièges de sortie). `npm run import:sokoban` adapte une collection au format standard `.xsb` (renseignez `EPOXY_SOKOBAN_FILE` et `EPOXY_SOKOBAN_CREDIT`) ; n'utilisez que des collections dont la licence autorise la réutilisation, et conservez le crédit. Les tunnels d'entrée et de sortie sont creusés sur n'importe quel côté de la salle, la sortie s'ouvrant là où le joueur peut se tenir une fois toutes les caisses en place, et le rapport d'import indique pourquoi chaque niveau rejeté n'a pas été retenu. Les deux écrivent des candidates dans `local/` pour le tri. `npm test` vérifie que chacune est solvable dans toutes les orientations, qu'aucun bloc ne peut sortir par ses ports et que rien n'y est décoratif ; `npm run report:pieces` écrit la solution de chaque pièce dans `local/piece-probe.txt`.

## Tests

```bash
npm test
```

La suite comprend `src/test/typographyGuard.test.ts`, qui parcourt chaque fichier texte suivi à la recherche de caractères typographiques interdits (tirets longs, guillemets courbes, points de suspension en un caractère, espaces insécables, ligatures).

Les tests tournent sous Node par défaut. Un fichier de test qui a besoin d'un DOM commence par `// @vitest-environment happy-dom` (utilitaires communs dans `src/test/domFixture.ts`). Les budgets de temps de génération se mesurent en temps CPU, ils tiennent donc quand toute la suite tourne en parallèle.

`npm run report:levels` mesure 200 niveaux générés en les comparant aux packs communautaires fournis, et écrit `reports/level-metrics.json`, avec des mesures de l'espace jouable : remplissage (cases ouvertes rapportées à leur rectangle englobant), part de cases ouvertes, culs-de-sac, carrefours, symétrie et présence de monstres. `npm run report:study` décrit comment les packs communautaires combinent les mécaniques, et `npm run mine:pieces` cherche des pièces d'énigme plus difficiles (environ une demi-heure) ; les deux écrivent dans `local/`.

## Build de production

```bash
npm run build
```

## Crédits

Les packs `CCLP 1` à `CCLP 5` fournis sont des jeux de niveaux créés par la communauté, et `Tile World Intro` est distribué avec le projet Tile World. Tous les niveaux de ces packs restent l'oeuvre de leurs auteurs respectifs. Epoxy n'est affilié à aucun détenteur de jeu commercial.

### Audio

Musique : Julien Bombled (pistes originales dans `public/audio/music/`).

Effets sonores : The Essential Retro Video Game Sound Effects Collection de Juhani Junkala, publiée par SubspaceAudio sur OpenGameArt (https://opengameart.org/content/512-sound-effects-8-bit-style), CC0 1.0, licence vérifiée le 2026-11-01.

Fichiers de `public/audio/sfx/` et effet servi par chacun :

- `sfx_sounds_impact3.wav`: blocked
- `sfx_coin_single3.wav`: chip
- `sfx_coin_double1.wav`: item
- `sfx_movement_dooropen1.wav`: door
- `sfx_sounds_powerup15.wav`: socket
- `sfx_sounds_button10.wav`: button
- `sfx_movement_portal5.wav`: teleport
- `sfx_sounds_negative2.wav`: thief
- `sfx_exp_short_hard4.wav`: bomb
- `sfx_deathscream_android5.wav`: death
- `sfx_sounds_fanfare1.wav`: win
- `sfx_lowhealth_alarmloop6.wav`: timer_warn

Pas : Impact Sounds de Kenney (https://kenney.nl/assets/impact-sounds), CC0 1.0, licence vérifiée le 2026-11-01.

- `footstep_concrete_000.ogg`, `footstep_concrete_001.ogg`, `footstep_concrete_002.ogg`: step
- `impactMetal_heavy_000.ogg`, `impactMetal_medium_000.ogg`: step_force
- `footstep_snow_000.ogg`, `footstep_snow_002.ogg`: step_ice
- `footstep_grass_001.ogg`, `footstep_grass_004.ogg`: step_fire

Pas dans l'eau : "ocean splash" de Thimras sur OpenGameArt (https://opengameart.org/content/ocean-splash), CC0 1.0, licence vérifiée le 2026-11-01.

- `cannon_miss.ogg`: step_water

### Graphismes

Habillage Sokoban : pack Sokoban de Kenney (https://kenney.nl/assets/sokoban), CC0 1.0, licence vérifiée le 2026-11-01.

Fichiers de `public/sprites/sokoban/` et rôle de chacun :

- `ground_06.png`: sol et base des cibles
- `block_05.png`: mur
- `environment_06.png`: marques de cible
- `crate_02.png`: bloc
- `crate_12.png`: bloc sur une cible

## Licence

Copyright 2026 Julien Bombled. Le code source d'Epoxy est publié sous [licence Apache 2.0](./LICENSE). Les packs de niveaux fournis ne sont pas couverts par cette licence.
