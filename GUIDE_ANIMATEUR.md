# Guide du stand : le robot qui apprend à passer parmi les gens

À lire en 5 minutes avant d'animer. Les sections suivent l'ordre conseillé pour présenter.

## En 30 secondes

Un robot virtuel apprend, par essais et erreurs, à traverser une salle pleine de gens pour atteindre un point, sans les heurter. Rien n'est inventé : chaque trajet est rejoué à partir d'une vraie simulation (SocNavGym) et d'un vrai réseau de neurones (SARL), sauvegardé à différents moments de son apprentissage.

## 1. La scène

- Salle de 10 × 10 m, 6 personnes qui marchent vers des destinations au hasard.
- Le robot (type TurtleBot, flèche jaune = sa direction) doit atteindre le **cercle vert**.
- Les personnes ne s'écartent pas pour lui : c'est au robot d'être poli.
- C'est **toujours la même salle**, avec les mêmes personnes aux mêmes endroits : on compare le robot à lui-même.
- Sortir de la salle compte comme une collision (le mur).

## 2. Le curseur « Entraînement » et le numéro d'essai

- Chaque position du curseur = le « cerveau » du robot sauvegardé après N essais.
- **Essai 0** : il ne sait rien. Il n'avance pas vers le but, le temps s'écoule.
- **Essais 1 à 3 000** : il imite un robot « professeur » (un algorithme classique, ORCA). Il bouge, mais sort vite de la salle.
- **Essais 3 000 à 13 000** : il s'entraîne seul et apprend de ses erreurs.
- En fin de trajet : **Réussi !**, **Collision !** ou **Temps écoulé**.
- Dans la salle affichée : collisions jusqu'à l'essai 5 500, première réussite à 6 025 (en 15 s), plus rapide ensuite (11 s à 13 000). À l'essai 7 900, il touche à nouveau quelqu'un.

## 3. Les récompenses (le panneau « Récompenses »)

| | |
|---|---|
| **+1** | Atteindre l'objectif |
| **−0,25** | Toucher une personne (l'essai s'arrête) |
| **−** | Passer à moins de 20 cm d'une personne : plus il est près, plus il perd |
| **0** | Tout le reste |

- Personne ne lui explique comment faire : il cherche seulement à gagner le plus de points possible.

## 4. La courbe « Progrès du robot »

- Mesurée sur **40 salles de test différentes** à chaque sauvegarde, pas seulement sur celle affichée.
- **Vert** : % d'essais où il atteint l'objectif. **Rouge** : % de collisions. Le repère suit le curseur.
- **Ce n'est pas linéaire** : 0 % au départ, 55 % après l'imitation, 68 % à 3 025 essais, **retombe à 52 %** vers 3 625, remonte à 85 % à 5 500, puis oscille entre 88 et 95 % avant d'atteindre **98 %** à 13 000. Les collisions passent de 62 % à 2 %.
- L'axe n'est pas à l'échelle : il y a plus de sauvegardes au début, là où il apprend le plus vite.

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
- C'est une illustration : dans la simulation, les personnes ne réagissent pas.

## 9. Limites, si on vous pose la question

- C'est une simulation, pas un vrai robot. Les personnes simulées ne l'évitent pas et ne changent pas d'avis.
- Le robot connaît parfaitement la position et la vitesse de chacun : pas de caméra, pas d'erreur de mesure.
- Il n'y avait pas de murs pendant l'entraînement : sortir de la salle compte comme une collision, et les murs sont seulement dessinés.
- « Réussi » inclut aussi des passages très près des gens (moins de 45 cm).
- L'entraînement complet a pris environ 1 h 40 sur un ordinateur portable.

## Pratique

- **Lancer :** `run.sh` (ou `run.bat` sous Windows). En secours, sans personnages 3D : ouvrir `index.html?simple=1`.
- **Commandes :** curseur ou flèches ↑ ↓ = moment de l'entraînement · Espace = pause · R = revenir au début · souris = tourner et zoomer.
- **Cases à cocher :** chaque calque s'affiche ou se masque. Gardez 2 ou 3 calques à la fois, sinon le sol devient chargé.
- **Parcours conseillé :** essai 0 → 3 000 → 5 500 → 13 000 avec *Choix du robot* et *Courbes* ; puis activer *Attention* ; puis *Distances sociales* en changeant de modèle.
