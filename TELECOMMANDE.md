# Télécommande — architecture (v47)

## Principe
Deux téléphones, un relais gratuit entre eux. Le téléphone de la salle (« hôte ») exécute les ordres ;
le téléphone de commande (« télécommande », `remote.html`) les envoie et affiche l'état.
Rien n'est requis : sans réseau, sans `relay.js` ou avec la case décochée, l'app est identique à la v36.

## Relais : ntfy.sh
Service de publication/abonnement gratuit, **sans compte ni clé**. Publication : `POST https://ntfy.sh/<canal>`.
Écoute : `EventSource https://ntfy.sh/<canal>/sse`. Le tout tient dans `relay.js` (≈ 130 lignes, sans dépendance) :
changer de relais (serveur ntfy auto-hébergé, Cloudflare Worker) ne touche que les deux fonctions `send` et `connect`.

Le relais est considéré comme **non fiable** : il ne voit que des octets chiffrés.

## Jumelage
- L'app génère un **code de 20 signes** (alphabet de 31 sans 0/O/1/I/L, ≈ 99 bits) : `XXXXX-XXXXX-XXXXX-XXXXX`.
- Le lien `…/remote.html#CODE` le transporte dans la partie après `#`, jamais envoyée à un serveur ;
  la page l'enregistre puis l'efface de l'adresse. On peut aussi saisir le code à la main.
- Du code, par SHA-256, on dérive : canal des ordres `ma…`, canal d'état `mb…`, clé AES-256-GCM.
  Le code ne circule jamais ; les noms de canaux n'en révèlent rien.
- « Nouveau code » dans l'app coupe l'ancienne télécommande.
- Sur iPhone, une app ajoutée à l'écran d'accueil a son propre stockage : saisir le code une fois dans cette app.

## Messages (JSON chiffré, AES-GCM, IV aléatoire, direction authentifiée)
Chaque message porte `t` (date) et `n` (nonce) : refusé s'il a plus de 60 s ou s'il a déjà été vu.

| Sens | `k` | Rôle |
|---|---|---|
| remote → hôte | `hello` | demande l'état (test de liaison) |
| | `cfg` + `set{}` | règle : `effect (time/sms/card/clock) minutes mode duration delay delay2 smsFrom smsText smsSound card card2 cardMorph clockT clockD cardMore` (liste blanche, valeurs bornées) |
| | `touch` | exactement le toucher d'un doigt (`rewind()`) |
| | `rearm` | réarmer (= appui long coin droit) |
| | `morph` | la « secousse » à distance (`doMorph()`) |
| | `goto` + `i` | programme : arme l'étape `i` (sans la jouer) |
| | `next` | programme : joue l'étape suivante tout de suite |
| | `show` + `card` | annonce directe : la carte apparaît tout de suite, ou remplace en fondu celle qui est affichée (effet « carte » seulement) |
| hôte → remote | `state` | `run` (mode tour ?), `fx`, `ph` (armed/busy/on/partial/done), `left`, `cfg{}`, `tour{i,n,pn,names[],nt,gap,pl}` (programme en cours), `re` (accusé de l'ordre) |

Règles côté hôte : un changement d'effet réarme toujours ; un changement de minutes réarme seulement si rien n'a encore été joué.
L'état est renvoyé à chaque ordre (accusé « ✓ reçu ») et à chaque changement de phase, aussi quand c'est un vrai doigt qui touche.
Pas de battement de cœur : un test de liaison toutes les 2 min seulement quand la télécommande est ouverte.

## Discrétion et sécurité
- Aucune interface de télécommande dans le mode tour ; la config n'existe que dans l'écran de réglages (étape 4).
- Un ordre non listé, mal formé, rejoué, trop vieux ou chiffré avec un autre code est ignoré en silence.
- Le relais voit l'heure et la taille des messages, pas leur contenu.
- Le service worker laisse passer le trafic du relais sans le mettre en cache.

## Limites connues
- **iOS** : l'autorisation du capteur de mouvement se demande toujours au bouton « Lancer le tour ». La télécommande ne peut pas lancer le tour. Le `morph` à distance fonctionne sans capteur.
- Un ordre `touch` envoyé hors réseau n'est **pas** mis en attente (il serait obsolète) : la télécommande affiche « Non envoyé ».
- Les quotas anonymes de ntfy.sh sont à confirmer avant un spectacle important (ordre de grandeur : quelques centaines de messages par jour et par adresse IP). L'usage normal en consomme peu ; au besoin, auto-héberger ntfy.

## Effets (v43)
- **L'heure devient…** (`clock`) : au toucher l'heure (et la date, si choisie) passe à la valeur voulue avec le défilement des chiffres, puis continue de tourner ; un second toucher rétablit l'heure réelle. Changer `clockT`/`clockD` à distance quand l'heure est déjà changée met l'écran à jour immédiatement.
- **Annonce directe d'une carte** : côté télécommande, case « Afficher dès que je choisis » ; valeur + couleur (ou carte spéciale) envoient `show`.

## Programmes (v46)
- Le **tour simple** (rubrique Effets) est inchangé. Les **programmes** (rubrique 3) sont des suites d'étapes stockées à part (`marche-arriere-prog-v1`) : plusieurs programmes, chacun nommé.
- Chaque étape a **tous** ses réglages d'effet ; on les modifie dans l'écran « Effets » habituel (barre « Terminé » en haut). Pendant ce temps, rien n'est écrit dans le tour simple.
- Entre deux étapes, le **déclenchement** de la suivante : `Au toucher`, `Après un temps` (0–60 s après que la précédente est jouée) ou `En secouant` (capteur autorisé au lancement ; sans capteur, le toucher ou le bouton « Étape suivante » de la télécommande prennent le relais). Le « délai après activation » est le délai habituel de chaque étape.
- Jeu : le bouton du bas devient « Lancer « nom » » quand la rubrique Programmes est ouverte. Au toucher/secousse, l'effet affiché est retiré proprement, puis l'étape suivante est jouée. Le dernier lancé est repris à l'ouverture directe.
- Télécommande : barre « Programme · Étape i sur n », étapes cliquables (`goto`), bouton « Étape suivante » (`next`).

## Secousses en chaîne (v47)
- Effet « carte » avec secousse : la suite des cartes est `card` (départ), `card2` (secousse 1), puis `cardMore[]` (secousses suivantes, 9 cartes au total). Chaque secousse (réelle, ou `morph` depuis la télécommande) passe à la carte suivante ; la suite repart du début à chaque nouvelle apparition. Une carte identique à la précédente est sautée.
- État hôte → télécommande : `mi` (secousse en cours) et `mn` (nombre de secousses) ; le bouton « Secousse 2 sur 3 » s'éteint à la fin de la suite.

## v48 — audit complet
- Télécommande : le lien `#code` re-jumelle même quand la page est déjà ouverte ; champ de code, en-tête de tour et arbre des programmes adaptés aux écrans 320 px.
- Les réglages stockés (tour simple et étapes de programme) sont validés à la lecture : une valeur abîmée ou hors bornes revient à une valeur valide au lieu de casser l'effet.
- Programmes : toucher/secousse juste après la fin d'un effet est pris en compte immédiatement (plus de course avec la surveillance de 150 ms).
- Résumés de rubriques raccourcis pour ne plus déborder.
