#!/usr/bin/env bash
set -euo pipefail

echo "==> Resizing swap to 4G for the build"
if swapon --show | grep -q '/swapfile'; then
  sudo swapoff /swapfile
fi
sudo rm -f /swapfile
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile >/dev/null
sudo swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
free -h | sed 's/^/    /'

cd /home/ubuntu/paybridgex

echo "==> Building Next.js (max-old-space-size=3584)"
export NODE_OPTIONS="--max-old-space-size=3584"
export SENTRY_RELEASE="$(git rev-parse HEAD)"
npm run build

echo "==> Starting PM2 (app + worker)"
pm2 startOrRestart ecosystem.config.js --update-env
pm2 save
pm2 list
