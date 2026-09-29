# Déploiement sur Proxmox (à partir de l'étape 2)

L'étape 1 (simulation seule) tourne sur ton PC. Ce guide sert quand il faut un serveur joignable.

## 1. Créer le conteneur LXC

Dans l'interface Proxmox, « Create CT » :

- Template : Debian 12 (standard)
- Unprivileged container : **coché**
- CPU : 1 cœur
- Mémoire : **1024 Mo**, swap 512 Mo
- Disque : 8 Go
- Réseau : DHCP ou IP fixe sur ton LAN
- Démarrer au boot : oui

La limite mémoire du LXC protège Immich et Home Assistant : si le jeu part en vrille, seul le
conteneur est touché.

## 2. Installer Node.js 22

```bash
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

Créer un utilisateur dédié (ne pas faire tourner le jeu en root) :

```bash
adduser --disabled-password --gecos "" contrees
su - contrees
git clone <ton-repo> contrees-vivantes
cd contrees-vivantes && npm install
```

## 3. Service systemd

`/etc/systemd/system/contrees.service` :

```ini
[Unit]
Description=Contrees vivantes
After=network.target

[Service]
User=contrees
WorkingDirectory=/home/contrees/contrees-vivantes
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now contrees
journalctl -u contrees -f
```

## 4. Accès pour les amis : Tailscale, sans ouvrir de port

Ne jamais ouvrir de port sur la box vers cette machine (elle héberge tes photos et ta domotique).

Tailscale dans un LXC non privilégié a besoin du périphérique TUN. Sur l'hôte Proxmox, ajouter à
`/etc/pve/lxc/<ID>.conf` puis redémarrer le conteneur :

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Dans le conteneur :

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Partager ensuite **uniquement ce nœud** avec les amis depuis la console Tailscale (fonction
« Share »). Ils accèdent au jeu via l'IP Tailscale du conteneur, sans voir le reste de ton réseau.

Alternative plus tard (accès public sans installation côté amis) : tunnel Cloudflare limité au
seul port du jeu.

## 5. Sauvegardes

Ajouter le conteneur aux sauvegardes Proxmox (vzdump) planifiées. L'état des contrées est dans
`data/` : c'est la seule chose précieuse.
