*English version: [../playtest.md](../playtest.md)*

# Guide du testeur

Merci de tester Epoxy. Le mode playtest enregistre, sur votre appareil uniquement, la façon dont vous jouez chaque niveau, afin de pouvoir ajuster les niveaux. Vous jouez normalement : le jeu tient les comptes.

## 1. L'activer

- [ ] Ouvrez le menu **Options**.
- [ ] Ouvrez la section **Avancé**.
- [ ] Appuyez sur **Mode playtest**. Le bouton s'allume.
- [ ] Vérifiez qu'un petit badge **Playtest** s'affiche dans le panneau du niveau.

Le mode est désactivé par défaut et reste actif jusqu'à ce que vous le coupiez.

## 2. Jouer normalement

- Jouez chaque niveau comme vous le feriez sans le mode. Utilisez l'indice, la solution, l'annulation et le redémarrage quand vous le voulez.
- Ne vous pressez pas et ne vous retenez pas : c'est le comportement réel qui est utile.
- Quitter un niveau sans le résoudre est normal, et c'est une information utile.

## 3. Noter le niveau

Après avoir résolu un niveau, et quand vous quittez un niveau essayé mais non résolu, un court formulaire apparaît :

| Question | Réponse |
|---|---|
| Difficulté | Une échelle courte, de trop facile à trop difficile |
| Plaisir | Une échelle courte, d'ennuyeux à super |
| Avez-vous eu un déclic ? | Oui ou Non |
| Remarque | Facultative, quelques mots |

- Chaque question est facultative.
- **Échap**, **Passer** ou un clic en dehors du formulaire le ferme sans enregistrer de note. Les données du niveau sont conservées quand même.
- Le formulaire peut toujours être passé, et vous pouvez reprendre le jeu dès que vous le fermez.

## 4. Exporter et envoyer

- [ ] Ouvrez **Options**, puis **Avancé**.
- [ ] Lisez **Sessions enregistrées** pour voir combien de sessions sont stockées.
- [ ] Appuyez sur **Exporter les données de playtest**. Un fichier nommé comme `epoxy-playtest-20261103-140509.json` est enregistré par votre navigateur.
- [ ] Envoyez ce fichier à la personne qui vous a demandé de tester (courriel, messagerie, dossier partagé).

Si vous exportez au milieu d'un niveau, le fichier contient aussi ce niveau en cours, marqué `in_progress`, avec le même identifiant que sa session finale. Si vous envoyez plusieurs fichiers, gardez la dernière copie de chaque identifiant de session.

**Effacer les données de playtest** supprime tout ce qui est stocké sur votre appareil, après confirmation. Exportez d'abord si vous voulez le garder.

## 5. Ce qui est enregistré

Pour chaque niveau joué (une session par série de tentatives) :

- le pack et le niveau, le jeu de règles et la version du jeu ;
- les aides que le niveau proposait (indice, solution, alerte d'impasse) ;
- l'heure de début et de fin, et votre temps de jeu actif (les pauses, un onglet masqué et les menus ouverts ne comptent pas) ;
- le nombre de tentatives (le premier essai, plus un par redémarrage ; mourir puis annuler reste la même tentative), de redémarrages, d'annulations, d'indices, de solutions affichées et d'alertes d'impasse ;
- chaque mort, avec sa cause et la case où elle a eu lieu ;
- si vous avez gagné (avec vos coups et votre temps) ou quitté, et comment vous avez quitté (autre niveau, autre pack, fermeture de l'onglet) ;
- les coups de votre tentative gagnante et de votre dernière tentative, sous la forme d'une courte suite de directions ;
- votre note et votre remarque, si vous en avez donné.

Rien d'autre n'est enregistré : ni nom, ni compte, ni information sur l'appareil.

## 6. Confidentialité

**Rien n'est envoyé automatiquement.** Les données restent dans le stockage local de votre navigateur. Le seul moyen pour qu'elles quittent votre appareil est le fichier que vous choisissez d'exporter puis d'envoyer vous-même. L'historique stocké est borné : au-delà d'un nombre fixe de sessions, les plus anciennes sont supprimées.
