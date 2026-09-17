# Guide du stand : le robot qui apprend à passer parmi les gens

À lire en 5 minutes avant d'animer. Les sections suivent l'ordre conseillé pour présenter.

## En 30 secondes

Un robot virtuel apprend, par essais et erreurs, à traverser une salle pleine de gens pour atteindre un point, sans les heurter. Tout se passe en direct : les personnes marchent avec un algorithme classique de déplacement de foule (ORCA), et le robot est piloté par un vrai réseau de neurones (SARL), entraîné dans le simulateur SocNavGym et sauvegardé à différents moments de son apprentissage.

## 1. La scène

- Salle de 10 × 10 m, 6 personnes qui marchent en continu. Dès qu'une personne arrive quelque part, elle repart ailleurs.
- Le robot (type TurtleBot, flèche jaune = sa direction) doit atteindre le **cercle vert**.
- Les personnes ne s'écartent pas pour lui : c'est au robot d'être poli.
- La salle ne s'arrête jamais :
  - objectif atteint : **Réussi !**, et le robot reçoit un nouvel objectif ;
  - personne touchée ou sortie de la salle : **Collision !**, le robot s'arrête un instant puis réapparaît ailleurs ;
  - 25 secondes sans atteindre l'objectif : **Temps écoulé**, et il reçoit un nouvel objectif.

## 2. Le curseur « Entraînement » et le numéro d'essai

- Chaque position du curseur = le « cerveau » du robot sauvegardé après N essais d'entraînement.
- Changer de position change le cerveau **sans arrêter la salle** : le même robot, au même endroit, se met à se comporter autrement.
- **Essai 0** : il ne sait rien. Il n'avance pas vers le but et le temps s'écoule.
- **Essais 1 à 3 000** : il imite un robot « professeur » (un algorithme classique, ORCA). Il avance vers le but mais heurte souvent les gens ou sort de la salle.
- **Essais 3 000 à 13 000** : il s'entraîne seul et apprend de ses erreurs.
- Sur 10 minutes en direct : le robot entraîné réussit environ 60 fois pour 14 collisions ; le robot non entraîné ne réussit jamais.

## 3. Les récompenses (le panneau « Récompenses »)

| | |
|---|---|
| **+1** | Atteindre l'objectif |
| **−0,25** | Toucher une personne (l'essai s'arrête) |
| **−** | Passer à moins de 20 cm d'une personne : plus il est près, plus il perd |
| **0** | Tout le reste |

- Personne ne lui explique comment faire : il cherche seulement à gagner le plus de points possible.

## 4. La courbe « Progrès du robot »

- Mesurée à l'avance sur **40 salles de test différentes** à chaque sauvegarde. Le repère suit le curseur.
- **Vert** : % d'essais où il atteint l'objectif. **Rouge** : % de collisions.
- **Ce n'est pas linéaire** : 0 % au départ, 55 % après l'imitation, 68 % à 3 025 essais, **retombe à 52 %** vers 3 625, remonte à 85 % à 5 500, puis oscille entre 88 et 95 % avant d'atteindre **98 %** à 13 000. Les collisions passent de 62 % à 2 %.
- L'axe n'est pas à l'échelle : il y a plus de sauvegardes au début, là où il apprend le plus vite.
- En direct, le robot entraîné a plus de collisions que sur la courbe : les objectifs tombent n'importe où, parfois au milieu des gens.

## 5. Le choix du robot (l'éventail de points colorés)

- 4 fois par seconde, il envisage **81 mouvements** : 16 directions (jusqu'à 45° à gauche ou à droite) × 5 vitesses, plus « s'arrêter ».
- Chaque point = un mouvement. Direction du point = où il tournerait ; distance au robot = sa vitesse (exagérée pour être visible).
- Couleur = score estimé : la récompense immédiate plus ce qu'il pense gagner ensuite. **Violet = mauvais, jaune = meilleur.** Le **cercle blanc** marque le mouvement choisi : le meilleur.
- Au début, les couleurs sont en désordre ; à la fin, le jaune se trouve clairement du côté qui contourne les gens.
- Pour prévoir, il suppose que chaque personne continue tout droit à la même vitesse.

## 6. L'attention (halos bleus sous les personnes)

- Le réseau SARL ne regarde pas tout le monde pareil : il donne un poids à chaque personne (le total fait 100 %).
- **Halo plus brillant** = personne qui compte plus dans sa décision.
- Robot non entraîné : tous les halos sont pareils. Robot entraîné : il se concentre sur quelques personnes, pas forcément les plus proches, plutôt celles qui vont croiser son chemin.

## 7. Les distances sociales (zones au sol)

- Zones de l'anthropologue Edward T. Hall : **intime** (0–45 cm), **personnelle** (45 cm–1,2 m), **sociale** (1,2–3,6 m). La zone dans laquelle entre le robot s'allume.
- Trois modèles au choix, avec les boutons du panneau :
  - **Cercle** : la même distance dans toutes les directions.
  - **Œuf** : plus grand devant la personne, plus court derrière.
  - **Gaussienne** (modèle de Kirby) : une « gêne » qui diminue avec la distance et s'allonge devant les gens qui marchent vite.
- **Important :** le robot n'a pas été entraîné avec ces zones. Sa seule règle sociale est « pas à moins de 20 cm ». Les zones servent à juger son comportement avec des critères humains.

## 8. Les réactions (visages au-dessus des têtes)

- Un visage apparaît quand le robot entre dans la zone d'une personne : **gêné** (zone personnelle), **fâché** (zone intime), **surpris** (contact).
- Il dépend du modèle choisi (cercle, œuf ou gaussienne).
- C'est une illustration : dans la simulation, les personnes ne réagissent pas au robot.

## 9. Déplacer l'objectif

- **Un clic sur le sol** place l'objectif à cet endroit. Le robot change aussitôt de direction.
- À faire faire aux visiteurs : mettre l'objectif derrière un groupe de personnes, puis comparer le robot entraîné et le robot non entraîné avec le curseur.
- Faire glisser la souris tourne la caméra au lieu de déplacer l'objectif.

## 10. Limites, si on vous pose la question

- C'est une simulation, pas un vrai robot. Les personnes simulées ne l'évitent pas.
- Le robot connaît parfaitement la position et la vitesse de chacun : pas de caméra, pas d'erreur de mesure.
- Il n'y avait pas de murs pendant l'entraînement : sortir de la salle compte comme une collision, et les murs sont seulement dessinés.
- « Réussi » compte dès que l'objectif est atteint, même si le robot est passé très près de quelqu'un.
- Les personnes suivent les mêmes règles que dans SocNavGym, recalculées en direct dans le navigateur.
- L'entraînement complet a pris environ 1 h 40 sur un ordinateur portable.

## Pratique

- **Lancer :** `run.sh` (ou `run.bat` sous Windows). En secours, sans personnages 3D : ouvrir `index.html?simple=1`.
- **Commandes :** curseur ou flèches ↑ ↓ = moment de l'entraînement · clic sur le sol = déplacer l'objectif · Espace = pause · R = remettre la salle à zéro · souris = tourner et zoomer.
- **Cases à cocher :** chaque calque s'affiche ou se masque. Gardez 2 ou 3 calques à la fois, sinon le sol devient chargé.
- **Parcours conseillé :** essai 0 → 3 000 → 5 500 → 13 000 avec *Choix du robot* et *Courbes* ; puis activer *Attention* ; puis *Distances sociales* en changeant de modèle ; enfin, laisser les visiteurs déplacer l'objectif.
