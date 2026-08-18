#!/usr/bin/env bash
set -euo pipefail

echo "==> Paybridgex EC2 provisioning (idempotent)"
export DEBIAN_FRONTEND=noninteractive

echo "==> [1/7] apt update + upgrade"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> [2/7] base packages: git nginx ffmpeg jq unzip build-essential certbot"
sudo apt-get install -y git nginx ffmpeg jq unzip build-essential ca-certificates curl python3-certbot-nginx
sudo systemctl enable nginx

echo "==> [3/7] Node.js 20 LTS"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJ="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$MAJ" -ge 20 ] && NEED_NODE=0
fi
if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node: $(node -v)  npm: $(npm -v)"

echo "==> [4/7] PM2 (global)"
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2
echo "    pm2: $(pm2 -v)"

echo "==> [5/7] swap (2G) to protect 'next build' from OOM"
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h | sed 's/^/    /'

echo "==> [6/7] directories"
mkdir -p /home/ubuntu/logs

echo "==> [7/7] clone/update repo"
if [ -d /home/ubuntu/paybridgex/.git ]; then
  cd /home/ubuntu/paybridgex
  git fetch origin
  git reset --hard origin/main
else
  git clone https://github.com/manishisblessed/Paybridgex.git /home/ubuntu/paybridgex
  cd /home/ubuntu/paybridgex
fi
echo "    repo commit: $(git rev-parse --short HEAD)"

echo "==> provisioning base complete"
