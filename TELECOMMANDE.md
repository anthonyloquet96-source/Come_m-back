# Télécommande — architecture (v45)

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
| | `cfg` + `set{}` | règle : `effect (time/sms/card/clock) minutes mode duration delay delay2 smsFrom smsText smsSound card card2 cardMorph clockT clockD after gap` (liste blanche, valeurs bornées) |
| | `touch` | exactement le toucher d'un doigt (`rewind()`) |
| | `rearm` | réarmer (= appui long coin droit) |
| | `morph` | la « secousse » à distance (`doMorph()`) |
| | `goto` + `i` | arme le tour n° `i` du programme (sans le jouer) |
| | `show` + `card` | annonce directe : la carte apparaît tout de suite, ou remplace en fondu celle qui est affichée (effet « carte » seulement) |
| hôte → remote | `state` | `run` (mode tour ?), `fx`, `ph` (armed/busy/on/partial/done), `left`, `cfg{}`, `tour{i,n,names[]}` (programme), `re` (accusé de l'ordre) |

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

## Programme de tours (v45)
- Un **programme** est une liste de tours (30 max). Chaque tour garde **tous** ses réglages d'effet (effet, minutes, délais, SMS, carte, morph, heure…) ; fond d'écran, heure et affichage restent communs.
- Stockage : `S.prog` (un instantané par tour) et `S.cur` ; `S` contient toujours les réglages du tour courant, donc tout le code existant est inchangé. Un seul tour = comportement d'avant.
- Le mode tour démarre toujours au tour 1. Quand un tour est **joué** (recul terminé, SMS affiché, carte visible, heure changée) et qu'il en reste un :
  - `Au toucher` : le toucher retire proprement l'effet (carte/heure/SMS) et joue le tour suivant ;
  - `Automatique` : le suivant démarre seul après `gap` secondes (0–60).
- Dernier tour : le toucher garde son effet normal (la carte disparaît, l'heure se rétablit).
- Télécommande : barre « Tour i sur n » ; toucher un tour = `goto` (armé, non joué) ; le bouton principal devient « Tour suivant » ; `after`/`gap` modifiables à distance.
- Menu : rubriques avec résumé, une seule ouverte à la fois, rappel du programme près de « Lancer le tour ».
