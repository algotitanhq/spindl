/teardown

Construis le simulateur d'un **disque dur 3,5" à plateaux, 7200 tr/min** (type disque de bureau SATA, 2 plateaux, 4 têtes). Dossier de la machine : `./hdd/` (hdd-shared, hdd-film, hdd-live), construit avec `node "$SKILL_DIR/sims/build.mjs" ./hdd-live`.

## Référence (règle 1)
Avant toute géométrie, cherche et note 2-3 références réelles : vue éclatée d'un disque 3,5" (iFixit ou démontage Seagate/WD), photo du bras d'actionneur avec l'aimant de la bobine, gros plan de la rampe de parking. Construis contre ces images, pas de mémoire.

## Chiffres (règle 2) — à confirmer sur la référence, puis une seule source dans `kin.js`
- Plateau : Ø 95 mm, trou central Ø 25 mm, épaisseur ~1,27 mm (alu) ; zone de données r ≈ 20 → 46 mm.
- Broche : 7200 tr/min → 120 tr/s, une révolution = 8,33 ms, latence rotationnelle moyenne 4,17 ms.
- Vitesse linéaire sous la tête : v = 2πr·120 → ~15 m/s au bord intérieur, ~35 m/s au bord extérieur (vérifie-le à la main et affiche-le).
- Actionneur rotatif (voice coil motor) : pivot, longueur pivot→tête ~45-50 mm, course angulaire ~30°, angle de skew de la tête qui varie d'environ ±15° sur la course.
- Temps d'accès : seek moyen ~8,5 ms, piste à piste ~1 ms ; profil de seek accélération / décélération (bang-bang adouci).
- Hauteur de vol de la tête : quelques nanomètres (montre l'échelle avec un zoom en ordres de grandeur, pas à l'échelle réelle).
- Zonage (ZBR) : plus de secteurs par piste à l'extérieur → débit qui baisse de l'extérieur vers l'intérieur (~250 → ~120 Mo/s).

## Une seule entrée (règle 3)
Le temps t. Angle de broche θ(t) = 2π·120·t. Position de l'actionneur = fonction d'une file de requêtes (LBA → zone, piste, secteur) précalculée au chargement : chaque seek suit le profil d'accélération, puis attend le secteur visé. Tout panneau (piste courante, secteur sous la tête, LBA, temps de seek, latence, débit, skew, courant VCM) lit la même fonction.

## Ce qui s'ouvre (règle 4)
- **Capot** : retiré / verre / en place.
- **Pile de plateaux** : écartée en vue éclatée pour montrer les 4 surfaces et les 4 têtes alignées sur le même cylindre.
- **VCM** : aimant supérieur soulevé, bobine visible, flèche de force qui change de signe pendant le seek.
- **Tête** : caméra qui descend jusqu'au slider, coussin d'air, piste et secteurs gravés en surface avec les servo wedges en accent.
- **Rampe** : chargement des têtes au démarrage, parking à l'arrêt (coupure d'alimentation).

## Boutons / sous-systèmes
Broche & moteur · Plateaux · Bras & VCM · Têtes · Rampe de parking · Servo · Électronique (PCB, préampli sur la nappe). Modes coupe : verre, section, plein. Vues caméra : dessus (vue de travail), 3/4, rasante au niveau des plateaux, intérieur tête.

## Tour automatique / film (~30 s)
1. Disque à l'arrêt, têtes sur la rampe (frame 0 = vignette, le disque doit être visible).
2. Spin-up jusqu'à 7200 tr/min, la jauge monte.
3. Chargement des têtes depuis la rampe.
4. Lecture séquentielle sur l'extérieur : débit élevé.
5. Seek long vers l'intérieur : profil de vitesse tracé en direct, skew qui tourne.
6. Attente rotationnelle : le secteur visé (accent) arrive sous la tête.
7. Plongée caméra jusqu'au slider, échelle des nanomètres.
8. Vue éclatée de la pile, 4 têtes sur le même cylindre.
9. Coupure d'alimentation : retour d'urgence sur la rampe, ralentissement.

## Son
Ronronnement de broche (fondamentale liée aux 120 Hz), clic discret à chaque seek, tac du parking. Rien sur le mouvement continu en dehors du bourdonnement de fond.

## Style
Studio clair, une seule couleur d'accent = le secteur / la piste en cours de lecture. Plateaux en miroir mais roughness ≥ 0,45 et envMapIntensity ≈ 0,5 pour éviter les traînées. Ne termine pas sans avoir relu les planches `--stills beats` selon la checklist du skill, puis livre le HTML live et le MP4 avec le son.
