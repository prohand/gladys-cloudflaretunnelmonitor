# Cloudflare Tunnel Monitor

Cette intégration surveille vos **tunnels Cloudflare** (`cloudflared`) depuis
Gladys : chaque tunnel est-il en ligne, combien de connexions tient-il, et le
`cloudflared` qui tourne chez vous est-il toujours connecté ? Chaque tunnel
devient un appareil Gladys, un changement d'état peut lancer une scène, et un
widget de tableau de bord montre tout d'un coup d'œil.

Elle ne fait que **lire** : elle ne crée, ne modifie et ne supprime jamais de
tunnel.

## Deux sources, utilisez-en une ou les deux

| Source    | Ce qu'il faut                                      | Ce que vous obtenez                                               |
| --------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| **Cloud** | Un jeton d'API Cloudflare et votre ID de compte    | Tous les tunnels du compte, avec l'état calculé par Cloudflare    |
| **Local** | L'adresse metrics d'un `cloudflared` sur le réseau | L'état de ce connecteur — il répond même quand Internet est coupé |

Le mieux est d'utiliser les deux : le cloud voit tous les tunnels, le
connecteur local répond encore quand c'est le lien Internet qui est tombé.

### Cloud : créer le jeton d'API

1. Ouvrez le tableau de bord Cloudflare, puis **Mon profil → Jetons d'API**
   (<https://dash.cloudflare.com/profile/api-tokens>).
2. **Créer un jeton → Jeton personnalisé → Commencer**.
3. Donnez-lui un nom (ex. `Gladys`) et ajoutez **une seule** permission :
   **Compte → Cloudflare Tunnel → Lecture**.
4. Dans **Ressources du compte**, incluez le compte qui porte vos tunnels.
5. **Continuer vers le résumé → Créer le jeton**, puis copiez le jeton.
   Cloudflare ne l'affiche qu'une fois.

Le jeton est en lecture seule : même s'il fuitait, personne ne pourrait
modifier un tunnel avec.

### Cloud : trouver l'ID de compte

Dans le tableau de bord Cloudflare, ouvrez votre compte : l'**ID de compte**
est affiché sur la page **Vue d'ensemble** (colonne de droite), ou dans le menu
du compte → **Copier l'ID de compte**. Il fait 32 caractères : des chiffres et
des lettres de `a` à `f`.

### Local : exposer les métriques de cloudflared

`cloudflared` a un petit serveur de métriques. Par défaut il n'écoute que sur
la machine elle-même, sur un port au hasard : donnez-lui une adresse fixe que
Gladys peut joindre.

- En ligne de commande : ajoutez `--metrics 0.0.0.0:2000`, par exemple
  `cloudflared tunnel --metrics 0.0.0.0:2000 run --token <jeton du tunnel>`.
- Dans `config.yml` : ajoutez la ligne `metrics: 0.0.0.0:2000`.
- Avec Docker : même option dans la commande, et publiez le port
  (`-p 2000:2000`).

Vérifiez depuis une autre machine : `curl http://<hôte cloudflared>:2000/ready`
doit répondre quelque chose comme
`{"status":200,"readyConnections":4,"connectorId":"…"}`.

Le serveur de métriques ne montre aucun secret, mais gardez-le sur votre réseau
local : n'ouvrez pas ce port sur Internet.

## Configuration

| Champ                              | Rôle                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Jeton d'API Cloudflare**         | Le jeton créé plus haut. Laissez vide pour n'utiliser que les connecteurs locaux.              |
| **ID de compte Cloudflare**        | L'ID de 32 caractères trouvé plus haut.                                                        |
| **Connecteurs cloudflared locaux** | Adresses metrics, séparées par des virgules : `http://192.168.1.10:2000, http://nas.lan:2000`. |
| **Intervalle de vérification (s)** | Secondes entre deux vérifications, de 30 à 3600 (60 par défaut).                               |

Le réglage **Préférer la connexion locale**, affiché par Gladys sous le
formulaire, choisit la source montrée pour un tunnel qui a les deux (voir plus
bas).

Cliquez ensuite sur **Tester la connexion** : la réponse dit, pour chaque
source, ce qui a répondu et ce qu'il faut corriger.

## Appareils

Les appareils apparaissent dans l'onglet **Découverte** de l'intégration :
ajoutez ceux que vous voulez suivre.

### Un appareil par tunnel (cloud)

| Fonctionnalité         | Valeurs                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| **Status**             | `healthy`, `degraded`, `down` ou `inactive`                        |
| **Online**             | 1 quand le tunnel fait passer du trafic (sain ou dégradé), 0 sinon |
| **Active connections** | Nombre de connexions vers le réseau de Cloudflare                  |

Ce que veulent dire les états, selon Cloudflare :

- **healthy** (sain) : le tunnel fonctionne normalement ;
- **degraded** (dégradé) : il fait encore passer du trafic, mais il manque des
  connexions ou des connecteurs ;
- **down** (hors ligne) : plus aucune connexion, le tunnel ne peut plus faire
  passer de trafic ;
- **inactive** (inactif) : le tunnel n'a jamais été lancé.

Renommer un tunnel chez Cloudflare garde son appareil Gladys : l'appareil est
lié à l'ID du tunnel, pas à son nom.

### Un appareil par connecteur local

| Fonctionnalité        | Valeurs                                            |
| --------------------- | -------------------------------------------------- |
| **Ready**             | 1 quand le connecteur tient au moins une connexion |
| **Ready connections** | Nombre de connexions qu'il tient (4 par défaut)    |

### Le badge de chaque appareil

- **local** : l'état vient d'un `cloudflared` de votre réseau ;
- **cloud** : il vient de l'API Cloudflare ;
- **injoignable** : aucune source ne répond pour cet appareil.

Quand un connecteur local sert un tunnel de votre compte, l'intégration les
relie toute seule (grâce à l'ID de connecteur donné par Cloudflare). Ensuite,
avec **Préférer la connexion locale** activé, le tunnel montre la vue locale ;
désactivé, la vue Cloudflare. Si la source préférée tombe, l'autre prend le
relais et le badge prend un point orange avec la raison.

## Scènes

### Déclencheurs

- **Un tunnel Cloudflare change d'état** — filtre sur le tunnel et sur le
  nouvel état. Variables : nom du tunnel, nouvel état, état précédent,
  connexions actives. Exemple : « quand le tunnel `home` passe **Hors ligne**,
  envoie-moi un message ».
- **Un connecteur cloudflared local change d'état** — filtre sur le connecteur
  et sur `Prêt`, `Non prêt`, `Injoignable`.
- **L'API Cloudflare ne répond plus** — déclenché une fois quand l'API commence
  à échouer (jeton refusé, compte inconnu, pas d'Internet…), pas à chaque
  vérification.

Chaque déclencheur part **une fois par changement**. Le dernier état connu est
gardé sur disque : un changement qui arrive pendant un redémarrage de Gladys
est quand même vu.

### Actions

- **Vérifier les tunnels Cloudflare maintenant** — lance une vérification tout
  de suite. Donne : nombre de tunnels, tunnels sains, tunnels en anomalie, et
  « tous les tunnels sains » (oui/non), à tester dans les actions suivantes.
- **Lire l'état d'un tunnel** — donne le nom, l'état, en ligne (oui/non) et les
  connexions actives d'un tunnel ou d'un connecteur local, d'après la dernière
  vérification.

## Widget de tableau de bord

Ajoutez le widget **Tunnels Cloudflare** à un tableau de bord. Il montre :

- le nombre de tunnels sains, et de tunnels en anomalie ;
- le nombre de connecteurs locaux prêts (si vous en avez) ;
- une ligne par tunnel (les anomalies d'abord) et par connecteur, avec son état
  et ses connexions ;
- un bouton **Vérifier**.

## En cas de problème

| Message                                             | Que faire                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cloudflare refuse le jeton d'API                    | Vérifiez le jeton, et sa permission **Compte → Cloudflare Tunnel → Lecture**.                   |
| Cloudflare ne connaît pas cet ID de compte          | Recopiez l'ID de compte ; vérifiez que le jeton inclut ce compte.                               |
| L'API Cloudflare est injoignable                    | Vérifiez que Gladys a accès à Internet (DNS, pare-feu).                                         |
| Un connecteur affiche **pas de réponse**            | Vérifiez `--metrics 0.0.0.0:<port>` sur cloudflared, le port, et `curl http://hôte:port/ready`. |
| Un connecteur répond mais ne tient aucune connexion | cloudflared tourne mais ne joint pas Cloudflare : regardez ses propres logs.                    |

## Vie privée

Le jeton est stocké dans Gladys et envoyé uniquement à `api.cloudflare.com`, en
HTTPS. Il n'est jamais écrit dans les logs. Les connecteurs locaux sont lus sur
votre réseau, sans aucun jeton.
