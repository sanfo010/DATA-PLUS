# DataPlus — architecture réseau et plan de prototype

**État : prototype WireGuard local uniquement.** Un tunnel de test réel a été
établi dans Ubuntu WSL2 et contrôlé par le backend local; il ne fournit aucun
accès Internet, n'est pas exposé publiquement et ne modifie pas le portefeuille.
Aucun serveur payant ni service de connexion utilisateur n'est déployé. Les
estimations ci-dessous ne sont ni un devis ni une autorisation de dépense. Les
prix publics cités le 23 novembre 2026 peuvent changer.

## 1. Résumé pour commencer

DataPlus a aujourd'hui une interface web Vite/TypeScript, l'authentification
Supabase et un portefeuille de démonstration conservé dans le `localStorage` du
navigateur. La réservation, l'activation, la consommation, les interruptions et
les notifications sont des simulations locales. Les migrations Supabase
définissent des tables protégées par RLS, mais l'application n'y enregistre pas
les opérations de portefeuille et les utilisateurs ne peuvent pas les modifier
directement.

**Recommandation :** commencer par un prototype fermé, avec des appareils de
l'équipe et une passerelle VPN centrale dont l'accès Internet est explicitement
autorisé par l'hébergeur. Il permet de vérifier un tunnel, la compatibilité
mobile et la mesure du trafic sans exposer l'adresse IP d'un foyer ni faire
dépendre le prototype d'un routeur résidentiel. Ne pas l'ouvrir au public et ne
pas vendre de volume avant d'avoir établi les coûts, les accords, la sécurité
et les obligations applicables.

Le concept « réserver chez soi, utiliser en déplacement » demande deux
ressources différentes :

1. Une connexion domestique peut servir de **chemin de transport** ou de
   **sortie Internet** si un appareil-gateway y reste allumé et joignable.
2. Un service VPN centralisé doit, lui, acheter ou obtenir une bande passante de
   sortie auprès d'un hébergeur ou d'un opérateur.

Une connexion Wi-Fi ne stocke pas de gigaoctets utilisables plus tard. Le
portefeuille doit représenter un **quota de service autorisé**, pas une preuve
que des données ont déjà été transférées.

## 2. État audité du projet

| Domaine | Présent dans le projet | Limite importante |
|---|---|---|
| Application | Vite et TypeScript, interface responsive | Une PWA/web app ne peut pas créer le VPN système à elle seule. |
| Identité | Supabase Auth et profils associés à l'utilisateur | L'identité ne fournit pas de tunnel ni d'identité d'appareil réseau. |
| Portefeuille | Opérations calculées côté navigateur et conservées sous une clé locale liée à l'utilisateur | L'utilisateur peut effacer ou modifier le stockage. Il n'est ni autoritatif ni vérifiable. |
| Schéma Supabase | `wallets`, `reservations`, `transactions` avec politiques RLS de lecture par propriétaire | Pas de service d'écriture ou de journal de consommation réseau. Ces tables ne débitent rien. |
| Activation | Simulation navigateur; le laboratoire WSL est séparé et opt-in | Aucune session produit ni confirmation d'accès Internet. |
| Consommation | Bouton de test qui écrit un montant choisi dans le navigateur | Ce compteur n'est pas une mesure d'octets réseau. |
| Clés / appareils | Registre de compte Supabase et enrôlement WireGuard individuel préparé en phase 9.1 | Le backend ne reçoit que la clé publique; aucun tunnel client physique n'a été validé. |
| Déploiement réseau | Backend local et laboratoire WireGuard WSL uniquement | Aucun service public ni test d'accès Internet. |

Fichiers pertinents :

- [src/main.ts](./src/main.ts) contient l'authentification, les écrans et la
  logique simulée.
- [supabase/migrations/202611231430_create_wallet.sql](./supabase/migrations/202611231430_create_wallet.sql)
  crée les tables du portefeuille et leurs politiques de lecture.
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) décrit les limites actuelles.

### Écarts à traiter avant tout solde réel

- Ne pas convertir la simulation navigateur en débit réel.
- Ne pas accepter du client une quantité consommée comme source de vérité.
- Ajouter un backend de confiance avant d'autoriser des mutations financières
  ou des quotas de trafic.
- Distinguer les états `requested`, `authorized`, `connecting`, `connected`,
  `interrupted`, `stopping`, `stopped` et `failed`. Le seul état `connected`
  devra venir d'une preuve de tunnel et d'une vérification de routage.
- Le contrôle « crédits » d'une session doit être atomique et idempotent : une
  répétition de requête ou un rejeu d'événement ne doit pas débiter deux fois.

## 3. Comparaison des sorties Internet possibles

### A. Passer par le domicile de l'utilisateur

Un petit appareil ou un routeur compatible au domicile établit un tunnel sortant
vers un point de rendez-vous DataPlus. Le téléphone distant rejoint ce système
et son trafic Internet sort par l'accès du foyer.

**Avantages**

- Le trafic utilise l'abonnement Internet du foyer.
- Une passerelle initiant une connexion sortante peut parfois joindre un service
  de rendez-vous même si le routeur domestique n'accepte pas de connexion
  entrante.
- C'est l'architecture la plus proche de l'idée d'une sortie Internet
  « personnelle ».

**Limites et risques**

- La passerelle doit rester alimentée, à jour et connectée. Une coupure, une
  veille, un changement de routeur ou une panne coupe la session.
- Le débit utile dépend de l'upload du foyer, du Wi-Fi, de la latence et des
  limites de l'abonnement. Un téléchargement à distance peut être plafonné par
  le débit montant du domicile.
- Les routeurs utilisent souvent le NAT. Le port forwarding n'est disponible
  que si le routeur et le fournisseur le permettent. Avec CGNAT, le foyer ne
  possède pas d'adresse IPv4 publique dédiée : une connexion entrante directe
  n'est généralement pas disponible. L'IETF réserve `100.64.0.0/10` au shared
  address space lié aux CGN ([RFC 6598](https://datatracker.ietf.org/doc/html/rfc6598)).
- DNS dynamique ne résout que le changement d'adresse IP ; il ne traverse pas
  le CGNAT. Un tunnel sortant vers un relais ou une adresse publique peut aider
  à établir le chemin, mais ajoute un service et du trafic de relais.
- Le trafic Internet paraît venir de l'adresse IP résidentielle. Un abus, une
  plainte ou une activité malveillante peut donc concerner le titulaire de
  l'abonnement. Il faut une autorisation explicite, des règles d'usage, la
  gestion des abus et une analyse juridique.
- L'abonnement résidentiel peut interdire ou limiter la revente, le partage
  public, l'hébergement de services ou l'usage commercial. Les règles dépendent
  du contrat et du pays : obtenir l'accord du fournisseur et l'avis juridique
  avant un pilote.
- Le foyer ne doit jamais devenir un relais public implicite. L'appareil doit
  être révocable, isolé du réseau local, maintenu et supervisé.

### B. Sortie centralisée DataPlus

Le téléphone établit un tunnel vers un ou plusieurs serveurs DataPlus dans des
centres de données. Le trafic Internet sort par les adresses de ces serveurs.

**Avantages**

- Les serveurs, versions, règles d'accès, métriques et arrêts de session sont
  contrôlés par DataPlus.
- Pas de routeur domestique ou de passerelle familiale à installer.
- Il est plus simple de mesurer le trafic à l'interface réseau du serveur et
  d'isoler les comptes.

**Limites et risques**

- DataPlus doit financer le trafic sortant : quelques utilisateurs peuvent
  rapidement dépasser le quota de transfert inclus d'une petite VM.
- Le fournisseur peut suspendre le serveur ou restreindre le trafic VPN/relay ;
  il faut lire les conditions d'utilisation et obtenir l'accord requis.
- Le trafic sort par les adresses IP de DataPlus. Cela concentre les plaintes,
  les demandes légales et le risque d'abus sur l'opérateur.
- Une VM bon marché ne garantit ni débit soutenu, ni capacité, ni disponibilité,
  ni qualité réseau pour un service VPN.
- Un unique point de sortie crée un point de panne et peut être éloigné des
  utilisateurs.

### Décision

Pour un prototype d'équipe, choisir **une sortie centrale explicitement
autorisée**, limitée à des appareils de test. Utiliser un vrai environnement
payant uniquement après accord de la personne responsable du budget. Pour
rester sans dépense, commencer par une maquette de protocole et un banc d'essai
sur matériel/connexion déjà possédés et autorisés ; ne pas exposer de service
public.

N'étudier une passerelle résidentielle qu'en second temps, avec un foyer
volontaire, une passerelle dédiée, un tunnel initié en sortie, une isolation
stricte et l'accord écrit du fournisseur Internet. Il s'agit d'une décision
produit et contractuelle, pas simplement d'une option du routeur.

## 4. WireGuard : rôle et limites

WireGuard est un protocole VPN moderne qui transporte des paquets IP chiffrés
entre des pairs identifiés par des clés publiques. Chaque appareil possède une
clé privée et partage sa clé publique avec le service. Le serveur associe le
pair à des adresses et routes autorisées. La documentation officielle décrit
les clés, les pairs, les endpoints et le keepalive NAT dans le
[Quick Start WireGuard](https://www.wireguard.com/quickstart/) et présente ses
objectifs sur [wireguard.com](https://www.wireguard.com/).

**Ce que WireGuard apporte :** tunnel chiffré, authentification cryptographique
du pair, transfert de paquets et interface réseau. Il transporte principalement
du trafic UDP.

**Ce qu'il ne fournit pas à lui seul :** comptes utilisateurs, inscription,
paiement, quota en Go, journal comptable, politique d'abus, tableau de bord,
service client ou preuve de facturation. DataPlus doit construire ces fonctions
dans un plan de contrôle distinct.

### Cycle de vie des clés

1. Le client natif génère une paire de clés par appareil.
2. La clé privée ne quitte pas l'appareil et n'est jamais envoyée à Supabase ou
   à l'API DataPlus. La clé publique et l'identifiant d'appareil sont inscrits
   après authentification.
3. Le backend valide le compte, l'appareil, le solde réservé et les limites,
   puis provisionne une autorisation de pair à durée limitée sur une passerelle.
4. Le client reçoit une configuration minimale contenant notamment l'adresse du
   serveur, sa clé publique et les routes autorisées. Les secrets ne sont pas
   journalisés.
5. À la fin, le backend révoque le pair côté passerelle. Une désinstallation,
   une perte ou une compromission d'appareil permet de révoquer sa clé.

Ne pas fabriquer une clé d'exemple dans le produit ou la présenter comme
opérationnelle. Pour la vraie implémentation, utiliser les APIs et bibliothèques
officielles et protéger les clés avec le stockage sécurisé du système
d'exploitation. Les clés serveur doivent rester dans un gestionnaire de secrets
ou un coffre du serveur.

### NAT et disponibilité

Un pair derrière NAT peut nécessiter un keepalive pour maintenir son mappage
NAT ; WireGuard indique qu'un intervalle de 25 secondes est souvent utile dans
ce cas, mais n'en fait pas une valeur à activer partout. Le keepalive augmente
le trafic et ne crée pas une adresse publique, ne garantit pas la traversée de
tous les CGNAT et ne remplace pas un relais joignable.

## 5. Architecture cible par étapes

```text
Application DataPlus
  ├─ Supabase Auth : identité de compte
  ├─ Client VPN natif : tunnel et état système vérifié
  └─ API DataPlus (HTTPS)
       ├─ appareils et clés publiques
       ├─ autorisation et cycle de vie des sessions
       ├─ portefeuille / ledger et idempotence
       └─ événements d'usage et historique
               ▲
               │ mesure authentifiée depuis la passerelle
               ▼
       Passerelle WireGuard centrale ── Internet
```

Le serveur de contrôle n'est pas nécessairement le routeur de trafic. Le
contrôle de compte et de crédit peut être séparé des passerelles, ce qui réduit
les secrets exposés et permet de superviser les nœuds. Pour le premier
prototype, garder ces composants simples : un backend d'API et une seule
passerelle de test, sans orchestrateur Kubernetes, multi-région ou réseau P2P.

### Responsabilités suggérées

- **Application web actuelle :** compte, profil, portefeuille consultatif,
  demande de connexion, états vérifiés remontés par le client natif. Aucun secret
  de serveur et aucune autorité de débit.
- **Client Android/iOS :** demande de permission VPN, gestion du tunnel natif,
  génération et stockage de la clé privée, remontée d'état local clairement
  identifiée comme état du tunnel et non comme preuve du trafic facturé.
- **API de contrôle :** valide le jeton Supabase côté serveur, associe
  l'utilisateur et ses appareils, autorise/refuse une session, délivre une
  configuration éphémère, révoque les pairs et vérifie les événements reçus.
- **Passerelle réseau :** applique l'autorisation de pairs, transporte le trafic
  et fournit les compteurs d'interface par pair/session. Elle n'accepte pas de
  pair arbitraire.
- **Ledger :** registre immuable des réservations, réserves de crédit,
  consommations et ajustements, écrit seulement par le service de confiance.
- **Supervision :** disponibilité du tunnel, saturation, erreurs, coût de
  bande passante, incidents et alertes, sans conserver inutilement l'historique
  détaillé de navigation.

### Échange d'API à concevoir

Ce contrat est une proposition, pas une API déjà déployée :

1. `POST /v1/devices` — enregistre un identifiant et une clé publique.
2. `POST /v1/sessions` — reçoit un identifiant d'idempotence et un appareil ;
   vérifie le compte, le crédit et les limites, réserve un quota et crée une
   session `authorized`.
3. Le client natif obtient la configuration nécessaire et demande au système
   de démarrer le tunnel.
4. `GET /v1/sessions/{id}` — retourne l'état serveur et un état de trafic
   vérifié, jamais un champ contrôlé par le client déclaré « actif ».
5. `POST /v1/sessions/{id}/stop` — arrête de façon répétable le tunnel et
   déclenche le rapprochement final des compteurs.
6. Des événements internes authentifiés de la passerelle signalent les
   compteurs cumulatifs, l'interruption ou l'arrêt. Chaque événement porte un
   identifiant unique, l'identifiant de session, un compteur monotone, une heure
   serveur et une signature ou un canal de service authentifié.

Toutes les opérations ont un propriétaire vérifié côté serveur. Un client ne
peut jamais soumettre `user_id` comme preuve d'identité ni modifier le solde par
une requête directe à Supabase.

## 6. Crédit et comptabilisation du trafic réel

Un compteur applicatif ou le trafic simulé de la phase 4 ne prouve rien. Dans
un futur service, le point de mesure doit être la passerelle qui transporte
effectivement les paquets, ou un composant réseau contrôlé et vérifiable. Il
faut aussi définir contractuellement ce que signifie un Go facturé : direction
montante, descendante, somme des deux, unité décimale ou binaire et traitement
des surcharges de tunnel.

### Procédure sûre de débit

1. À l'ouverture d'une session, le backend réserve atomiquement le quota
   disponible. Deux demandes concurrentes ne peuvent pas réserver la même
   quantité.
2. La passerelle produit des compteurs cumulatifs de bytes par pair/session.
   Le backend vérifie identité, séquence, monotonie, duplicats et limites.
3. À chaque rapprochement, le service calcule le delta entre le dernier
   compteur accepté et le nouveau, puis écrit un événement comptable avec une
   clé unique. Une répétition du même événement ne crée pas de nouveau débit.
4. Le crédit consommé est rapproché dans une transaction atomique avec le
   registre et la réserve. Le client ne décide jamais de la quantité à débiter.
5. À la limite, le plan de contrôle ordonne à la passerelle de bloquer ou
   révoquer le pair. Le client affiche « arrêt demandé » puis « arrêté » après
   confirmation de la passerelle.
6. À la fermeture ou après une interruption, le backend rapproche le dernier
   compteur disponible, libère le reliquat de réserve et clôture la session.
   Les événements en retard sont dédupliqués.

Réseau et base de données ne forment pas une transaction distribuée unique.
Prévoir une courte réserve de crédit, une marge d'arrêt technique mesurée, des
reprises idempotentes, un rapprochement périodique et un journal auditable. Ne
pas promettre une coupure à l'octet exact avant de mesurer et tester les délais
réels d'application de la révocation.

Les compteurs WireGuard/noyau peuvent contribuer à une mesure, mais il faut
valider qu'ils sont disponibles et correctement séparés par pair, qu'ils
survivent aux redémarrages et qu'ils sont cohérents avec la politique de
facturation. Les bytes de tunnel et les octets livrés à l'application ne sont
pas forcément identiques. Une attestation de trafic ne doit pas être remplacée
par une valeur envoyée librement par le téléphone.

## 7. Sécurité et exploitation

- Chiffrer API et administration en TLS ; utiliser une authentification forte
  entre services et restreindre l'administration aux opérateurs autorisés.
- Conserver les clés privées des appareils sur l'appareil. Ne jamais enregistrer
  de clé privée, token d'administration ou clé Supabase `service_role` dans le
  code client, les journaux, les captures d'écran ou le dépôt.
- Limiter les sessions par compte et appareil, prévoir expiration, révocation,
  rotation, limitation de débit et détection d'abus.
- Cloisonner les peers : une clé ne doit accéder qu'à ses routes. La passerelle
  ne doit pas exposer le réseau d'administration, les réseaux privés du foyer
  ou les autres utilisateurs.
- Filtrer l'usurpation d'adresse et les paquets qui ne correspondent pas aux
  adresses allouées à un peer. Durcir le serveur, mettre à jour le noyau et
  WireGuard, surveiller les dépendances et prévoir une procédure de réponse aux
  incidents.
- N'enregistrer que les événements opérationnels utiles : ouverture, refus,
  révocation, total de bytes, panne et changements administratifs. Documenter
  les durées de conservation et contrôler l'accès. Ne pas journaliser les
  contenus, DNS ou destinations visités sans nécessité, base légale et
  information claire.
- Prévoir support, plaintes d'abus, fraude, demandes légales, rétention imposée,
  protection des mineurs et procédures de suspension. Les obligations
  applicables varient selon le pays et le rôle de DataPlus ; demander un avis
  juridique avant toute offre publique.
- Vérifier les conditions du fournisseur d'hébergement et, pour une sortie
  résidentielle, celles de chaque FAI concerné. N'assimiler ni la possession
  d'une connexion ni une autorisation du routeur à un droit de revente.
- Si des utilisateurs de l'UE sont concernés, déterminer les rôles et
  obligations de protection des données, les transferts, la minimisation, les
  droits des personnes et la notification d'incident avec un professionnel
  compétent.

## 8. Android, iOS et PWA

- **Android :** l'API officielle [`VpnService`](https://developer.android.com/develop/connectivity/vpn)
  permet à une application autorisée par l'utilisateur de créer une interface
  VPN. Le système présente une demande d'autorisation et applique ses règles de
  cycle de vie. Il faudra gérer l'état de premier plan, les changements de
  réseau, la reprise, l'arrêt et les politiques de distribution.
- **iOS :** la famille d'API
  [Network Extension](https://developer.apple.com/documentation/networkextension)
  et le type `NEPacketTunnelProvider` permettent un tunnel IP via une extension
  native, avec entitlements, autorisations, cycle de vie et processus de revue
  à vérifier pour le cas d'usage exact. Ne pas supposer qu'une simple app web ou
  une bibliothèque seule obtient ces droits.
- **PWA :** peut gérer compte, profil, explications, demandes d'activation et
  historique fourni par le serveur. Elle ne remplace pas un client VPN système,
  ne contrôle pas les routes globales et ne mesure pas de manière autoritative
  le trafic du tunnel.
- **Architecture recommandée :** garder l'interface web actuelle pour le
  produit et ajouter ultérieurement un client natif (ou une coque native avec
  extensions VPN natives) derrière un petit contrat partagé avec l'API. Une
  coque ne rend pas les APIs système disponibles à JavaScript.

Références des plateformes :
[Android VPN guide](https://developer.android.com/develop/connectivity/vpn),
[Apple Network Extension](https://developer.apple.com/documentation/networkextension),
[Apple Packet Tunnel Provider](https://developer.apple.com/documentation/networkextension/packet-tunnel-provider).
Vérifier la documentation de distribution et les entitlements au moment du
développement, car les exigences peuvent évoluer.

## 9. Coûts : comment estimer avant d'acheter

La facture d'un VPN est surtout liée au trafic transféré, pas au nombre de
lignes de code :

```text
trafic mensuel en sortie ≈ utilisateurs actifs × Go moyens consommés
coût réseau ≈ trafic facturable × tarif de sortie du fournisseur
coût total = VM/passerelle + sortie réseau + sauvegarde/supervision
             + adresses/IP + support + taxes + conformité
```

Exemples de volume, sans tarif supposé :

| Usage | Trafic utile sortant approximatif |
|---|---:|
| 20 testeurs × 2 Go/mois | 40 Go/mois |
| 100 utilisateurs × 10 Go/mois | 1 000 Go, soit environ 1 To/mois |
| 1 000 utilisateurs × 10 Go/mois | 10 000 Go, soit environ 10 To/mois |

À titre de **plancher d'instance seulement**, la page publique DigitalOcean
affichait à la date de consultation un Basic Droplet de 512 MiB / 1 vCPU à
**4 USD par mois**, avec **500 GiB de transfert** listés
([tarifs Droplets](https://www.digitalocean.com/pricing/droplets)). Ce n'est
pas une recommandation de capacité, un devis de VPN ou une garantie que
l'utilisation est autorisée. Une petite VM peut être inadaptée au chiffrement,
au débit soutenu et à l'isolation. Tarifs, dépassements, région, taxes, IPv4,
anti-DDoS et conditions d'usage sont à vérifier avant toute commande. Une
instance de 4 USD ne signifie pas que 500 Go de service VPN coûtent 4 USD tout
compris.

Avant le pilote, choisir une région et demander au fournisseur un devis écrit
ou relever dans son calculateur : prix d'une VM adaptée, transfert inclus et
surplus, débit garanti, règles VPN/relais, disponibilité, adresses IPv4, taxes
et politique de suspension. L'architecture domestique évite cette sortie cloud
pour le trafic qui part du domicile, mais consomme l'upload et le quota de
l'abonnement du foyer ; son coût est transféré à l'utilisateur, pas supprimé.
**Aucun achat ni déploiement n'a été fait dans cette phase.**

## 10. Étapes de réalisation proposées

1. **Décision produit/juridique :** choisir le pays pilote, le modèle de sortie,
   qui fournit la bande passante, les conditions d'usage et qui répond des abus.
2. **Prototype technique fermé :** appareils de l'équipe, un seul nœud
   autorisé, utilisateurs allowlistés, données non sensibles, budget explicitement
   approuvé et arrêt d'urgence.
3. **Client natif :** commencer sur une seule plateforme, demander l'autorisation
   système, gérer les clés sur appareil et prouver le démarrage/arrêt.
4. **Plan de contrôle :** service d'appareils et de sessions qui vérifie Supabase
   côté serveur et configure/révoque les peers. Aucun secret admin dans le
   navigateur.
5. **Comptabilité :** événements de trafic par peer, journal idempotent,
   rapprochement à partir de compteurs réels, réservation et débit atomique,
   tests de courses et de reprise après panne.
6. **Sécurité et coûts :** audit externe, modèle de menace, tests d'isolation,
   limite de trafic, alertes de facture, procédure d'abus et de support.
7. **Pilote limité :** volontaires informés, consentement explicite, limites
   basses, métriques, arrêt immédiat possible, revue juridique et de sécurité.
8. **Production :** haute disponibilité, multi-région seulement si justifié,
   astreinte, SLA réaliste, conformité, politique de confidentialité et support.

Ne passer à l'étape suivante que si la précédente a des critères d'acceptation
mesurables et un responsable identifié.

## 11. Matrice de tests futurs

**Aucun des tests réseau ci-dessous n'a été exécuté ni réussi.** Ils nécessitent
une passerelle autorisée, des appareils natifs et des scénarios contrôlés.

| Test | Vérification nécessaire | Résultat requis |
|---|---|---|
| Tunnel WireGuard | Clé d'appareil autorisée, handshake et interface native | Tunnel établi et clé révocable ; aucune clé privée dans l'API ou les logs |
| Authentification | Jeton absent, expiré, révoqué, utilisateur A/B | Seulement le propriétaire autorisé peut inscrire l'appareil et la session |
| Route Internet | Adresse de sortie contrôlée avant/après, IPv4/IPv6 et DNS | La route choisie passe par la passerelle ; l'UI n'annonce connecté qu'après preuve serveur |
| Compteurs | Générer un volume de test connu dans les deux sens et comparer les bytes | Écart documenté, monotonicité et définition du volume facturé validées |
| Déconnexion | Arrêt demandé, arrêt forcé, fermeture application | Pair révoqué, état serveur arrêté et reliquat rapproché une seule fois |
| Interruption réseau | Couper Wi-Fi, passer au mobile, arrêter le serveur | État interrompu, politique de reprise explicite, aucun crédit débité en double |
| Épuisement | Approcher la limite avec trafic continu | La passerelle arrête le peer ; dépassement maximal mesuré et acceptable |
| Reconnexion | Perdre le réseau puis le retrouver | Idempotence de session et compteurs conservés ; pas de nouvelle réserve double |
| Deux appareils / utilisateurs | Sessions concurrentes et échanges d'identifiants | Isolation confirmée, limites par compte respectées, aucun accès croisé |
| Rejeu d'événement | Réémettre un événement de consommation | Une seule écriture comptable grâce à la clé unique |
| CGNAT / mobilité | Test sur différents opérateurs mobiles et routeurs | Limites et éventuel besoin de relais documentés, sans promesse de compatibilité universelle |
| Charge / facture | Trafic soutenu autorisé et observation du fournisseur | Débit, CPU, latence, transferts et coût mesurés avant élargissement |

## 12. Glossaire

- **VPN / tunnel :** chemin chiffré entre l'appareil et un serveur. Il protège le
  transport, mais ne rend pas automatiquement l'accès gratuit ou anonyme.
- **Pair :** appareil ou serveur autorisé à participer au réseau WireGuard.
- **Clé publique / privée :** la publique identifie le pair ; la privée est un
  secret qui doit rester sous le contrôle de son propriétaire.
- **NAT :** mécanisme du routeur qui partage une adresse Internet entre plusieurs
  appareils et rend souvent les connexions entrantes plus difficiles.
- **CGNAT :** NAT supplémentaire contrôlé par le fournisseur d'accès, partagé
  entre abonnés ; le client ne maîtrise pas ce routeur.
- **Passerelle / exit node :** serveur qui reçoit le trafic du tunnel et le
  transmet vers Internet.
- **Plan de contrôle :** service qui décide qui peut se connecter, sur quel
  appareil et pour combien de temps.
- **Idempotence :** répéter une requête après une panne ne produit pas une
  deuxième session ou un deuxième débit.
- **Ledger :** registre comptable d'événements immuables permettant de
  recalculer le solde et d'expliquer chaque débit.
- **Egress / sortie :** données envoyées par le serveur vers Internet ; c'est
  souvent une ligne de coût importante d'un VPN.

## 13. Sources techniques

- WireGuard, présentation : <https://www.wireguard.com/>
- WireGuard, configuration et NAT keepalive : <https://www.wireguard.com/quickstart/>
- IETF RFC 6598, espace IPv4 partagé pour CGN : <https://datatracker.ietf.org/doc/html/rfc6598>
- Android, API VPN : <https://developer.android.com/develop/connectivity/vpn>
- Apple, Network Extension : <https://developer.apple.com/documentation/networkextension>
- Apple, `NEPacketTunnelProvider` : <https://developer.apple.com/documentation/networkextension/packet-tunnel-provider>
- DigitalOcean, tarif public des Droplets : <https://www.digitalocean.com/pricing/droplets>

## 14. Phase 6 — fondations des appareils et des sessions

La phase 6 ajoute une migration Supabase pour `devices`, `vpn_sessions` et
`vpn_session_events`, ainsi que les écrans **Mes appareils** et **Sessions
DataPlus**. RLS limite la lecture au propriétaire; les écritures directes des
rôles `anon` et `authenticated` sont révoquées. Les RPC authentifiées
inscrivent/révoquent un appareil, créent une session `requested` à zéro octet
et demandent son arrêt.

Une inscription d'appareil ne prouve pas l'identité cryptographique de celui-ci.
Une session `requested` ne démarre aucune connexion et ne touche pas le
portefeuille de démonstration. La base réserve `connected` aux sessions ayant
une réservation positive et les éléments de preuve de passerelle requis. La
mesure de trafic reste réservée à `service_role`.

La migration est appliquée dans les projets `DATAPLUS` et `DataPlus-Staging`.
Les RPC/RLS ont été vérifiées dans le projet de staging avec deux vrais comptes
Auth; les résultats sont consignés dans [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).
Il n'y a pas eu de test de tunnel ou de débit Internet réel.

## 15. Phase 7 — backend central préparé

Un backend Node.js/Express/TypeScript indépendant est ajouté sous `server/`.
Le frontend peut l'utiliser pour les appareils et sessions en définissant
`VITE_DATAPLUS_API_URL`; sans cette variable, le chemin Supabase phase 6 reste
inchangé.

Pour chaque route utilisateur, le serveur vérifie le bearer token avec
Supabase Auth (`auth.getUser`) et utilise ensuite un client Supabase portant le
même JWT utilisateur. Les requêtes restent soumises aux privilèges Postgres et
aux politiques RLS existantes. Le serveur ne reçoit pas de `user_id` du client
et n'utilise pas de clé `service_role` pour les opérations utilisateur.

Les routes documentées dans [BACKEND.md](./BACKEND.md) couvrent l'identité,
les appareils, la demande/l'arrêt et la consultation des sessions. Le contrat
`WireGuardGateway` dispose d'un adaptateur optionnel local WSL, désactivé par
défaut et interdit en production. Les sessions du laboratoire sont temporaires
et distinctes des sessions Supabase. Le récepteur de mesures de production
reste désactivé tant que ses secrets serveur ne sont pas configurés.

Les tests locaux vérifient les routes, les permissions, la validation,
l'isolation inter-comptes, l'authentification simulée via `auth.getUser` et le
contrat HMAC. Ils ne constituent pas une connexion à Supabase staging ni à une
passerelle. Aucune clé WireGuard, aucune consommation et aucune mutation de
portefeuille ne sont créées.

### Résultat du laboratoire local

La phase 8 a installé `wireguard-tools` dans Ubuntu WSL2 et un test réel a été
exécuté le 24 novembre 2026. Le serveur et le client ont échangé sur
`10.77.0.0/24` avec un handshake WireGuard visible; `ping` a transmis 3 paquets
sur 3 avec 0 % de perte. `wg show` a également affiché des compteurs transmis
et reçus réels.

Le laboratoire n'a pas configuré `AllowedIPs=0.0.0.0/0`, aucune règle NAT,
aucun forwarding Internet et aucune route Windows. Il a été arrêté après le
test; l'interface `wgdataplus` ne reste pas active.

Les clés privées sont conservées dans `/root/dataplus-lab`, permissions
restreintes à `0700/0600`, hors du dépôt Git. Les scripts
`setup-wg-lab.sh`, `test-wg-lab.sh` et `stop-wg-lab.sh` créent, vérifient et
arrêtent uniquement le laboratoire local. L'adaptateur backend
`LocalWslWireGuardGateway` peut démarrer, mesurer et arrêter ce laboratoire,
mais reste désactivé tant que `DATAPLUS_WG_LAB_ENABLED=1` n'est pas défini.

**Limite de quota :** la RPC existante comptabilise les compteurs authentifiés
et demande l'arrêt quand la réservation est épuisée; le backend seul ne peut
pas garantir une coupure immédiate du trafic. Une passerelle doit imposer la
limite au niveau réseau, et le débit du portefeuille exige un service atomique
et une politique d'éventuel dépassement. Ces fonctions restent non implémentées.

## 16. Phase 8 — laboratoire WireGuard local

**État : tunnel local réellement vérifié.** L'environnement Windows 11 utilise
Ubuntu WSL2 avec `wireguard-tools`. Le laboratoire privé comprend une interface
WireGuard serveur et un client de test dans un namespace Linux, sur
`10.77.0.0/24` et un transport privé `10.88.0.0/30`.

Le test direct a confirmé le handshake et un ping privé de 3 paquets sur 3,
sans perte; `wg show` a fourni de vrais compteurs. Aucun `AllowedIPs` Internet,
NAT, forwarding ou changement de route Windows n'a été configuré. Les clés
privées restent dans `/root/dataplus-lab` avec permissions restrictives, hors
du dépôt. L'interface a été arrêtée après les tests.

## 17. Phase 9 — contrôle du laboratoire par le backend

Le backend dispose de routes authentifiées dédiées au laboratoire et d'un
adaptateur qui invoque exclusivement des scripts WSL fixes. Les entrées
utilisateur ne sont jamais incorporées à une commande système. L'activation
`DATAPLUS_WG_LAB_ENABLED=1` est opt-in, refusée en production et lie l'API à
`127.0.0.1`.

Une demande vérifie l'appareil actif via le contexte Supabase authentifié, puis
le backend lance le client WSL de test et lit le handshake récent ainsi que les
compteurs réels avant de déclarer la session du laboratoire `connected`. Les
opérations sont sérialisées et une seule session globale peut être active.
L'accès aux sessions est limité à leur propriétaire; les sessions restent en
mémoire et ne sont ni écrites dans `vpn_sessions`, ni comptabilisées dans le
portefeuille. L'appareil de compte autorise la demande, mais n'est pas encore
un pair WireGuard physique.

Le test `npm run test:wsl-lab` a exercé le parcours authentifié API → adaptateur
→ vrai handshake/compteurs WSL → arrêt confirmé. Le tunnel était arrêté à la
fin et le contrôle final a vérifié `interface_up=0`. `npm run test:backend` et
`npm run build` passent également.

**Limites restantes :** aucune configuration n'est fournie à un client
physique; aucun accès Internet, second appareil, quota, consommation du
portefeuille, persistance de session ou service staging n'a été testé. Les
sessions en mémoire sont perdues au redémarrage; un tunnel actif devenu
orphelin bloque les nouveaux démarrages plutôt que d'être détruit
automatiquement.

## 18. Phase 9.1 — identités WireGuard par appareil

Un chemin de laboratoire distinct utilise l'interface WSL `wgdpdev0` et le
sous-réseau privé `10.78.0.0/24`; les scripts et le pair partagé historique
restent séparés. Chaque appareil actif a sa propre clé publique, son adresse
privée et son état de révocation. La paire de clés est générée sur l'appareil
natif; ni le backend ni la passerelle WSL ne génèrent ou ne stockent la clé
privée de cet appareil. La passerelle conserve les métadonnées publiques dans
un répertoire dédié limité à `0700`. Les routes backend lient chaque opération
au propriétaire authentifié et à un appareil de son compte.

Le navigateur ne peut pas récupérer la configuration WireGuard : l'endpoint
retourne explicitement `native_enrollment_required` tant qu'un client natif et
une preuve d'identité adaptée ne sont pas disponibles. La révocation retire le
pair précis sans interrompre les autres. Une identité révoquée n'est pas
recréée implicitement; la rotation reste à concevoir. Aucun tunnel client ou
accès Internet n'est revendiqué par la simple création du pair.

La migration additive
`202611241245_create_wireguard_device_peers_and_lab_sessions.sql` contient
uniquement des métadonnées publiques et des sessions de laboratoire séparées
des tables facturables. Le propriétaire a confirmé son application sur
`DataPlus-Staging`; une inspection SQL en lecture seule a confirmé tables,
colonnes, index, contraintes, relations, RLS et privilèges attendus. La
connexion service-role et la persistance réelle à travers un redémarrage du
backend restent à valider. Le service-role reste exclusivement côté backend.

La persistance opt-in porte actuellement sur les sessions de laboratoire
historiques en mode pair partagé (`DATAPLUS_WG_SESSION_PERSISTENCE=1` avec
`DATAPLUS_WG_LAB_ENABLED=1`). Au redémarrage, l'état est relu et comparé à
l'observation réelle de la passerelle; sans handshake récent, la session est
`interrupted`. Les compteurs connus sont préservés, puis les bases sont
réinitialisées pour ne pas recompter les compteurs cumulés après reprise.
Cette persistance ne constitue pas encore une session client par pair
individuel; le parcours de démarrage d'un client natif reste à construire.

Vérifications effectuées : `npm run build`, `npm run test:backend` et
`npm run test:wsl-device-peers` réussis. Le test WSL a créé deux identités
éphémères via les vrais outils WireGuard, vérifié leurs clés/adresses
distinctes et révoqué un seul pair sans changer l'autre. Les identités de test
ont été supprimées et l'interface dédiée arrêtée ensuite. Aucun handshake
client, échange de trafic, test Supabase, routeur Windows ou tunnel Internet
n'a été exercé. La vérification finale a confirmé `wgdpdev0` arrêté et
l'interface historique inactive.

### Préparation du premier test physique

Le premier appareil physique doit utiliser une paire de clés WireGuard créée
sur l'appareil, jamais générée côté backend puis copiée vers le navigateur.
Sur Windows, l'application WireGuard officielle peut générer la clé privée et
exporter uniquement l'identité publique vers DataPlus. Le backend envoie au
laboratoire la clé publique, reçoit une adresse privée `10.78.0.x/32` et
conserve uniquement les métadonnées publiques dans Supabase.

Le test reste limité au réseau privé jusqu'à validation du handshake. Il ne
doit ni modifier les routes Windows, ni activer NAT/forwarding, ni fournir
Internet. Le fichier client doit contenir l'adresse privée allouée, la clé
publique du serveur WSL, `ListenPort`/endpoint locaux autorisés et aucune clé
Supabase ou clé privée côté application web.

Avant toute tentative physique, exécuter :

```powershell
npm run check:wg-physical-readiness
```

Ce contrôle vérifie uniquement `wsl.exe`, Ubuntu, `wireguard-tools` et l'état
des interfaces. Il ne configure aucun réseau ni ne crée de clé. Pour réaliser
le test, utiliser un appareil situé sur le même réseau autorisé, joindre son
endpoint local sans exposer `51821` publiquement, puis vérifier uniquement
un ping vers l'adresse `10.78.0.1` du laboratoire.
