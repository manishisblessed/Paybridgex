#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "  Paybridgex — Redeploy"
echo "=========================================="

cd /home/ubuntu/paybridgex

echo "[1/6] Pulling latest code..."
git pull origin main

# Tag this deploy's Sentry release with the exact commit. Exported here so BOTH
# the build (client/server bundles, source-map upload) and the PM2 restart below
# (server + worker runtime) share the same release identifier.
export SENTRY_RELEASE="$(git rev-parse HEAD)"
echo "      Sentry release: $SENTRY_RELEASE"

echo "[2/6] Validating .env (drift check)..."
bash deploy/check-env.sh .env

echo "[3/6] Installing dependencies..."
npm ci --production=false

echo "[4/6] Generating Prisma client..."
npx prisma generate

echo "[5/6] Applying database migrations..."
npx prisma migrate deploy

echo "[6/6] Building and restarting..."
# ── Build memory guard ───────────────────────────────────────────────
# The server build is COMPILE-ONLY: `typescript.ignoreBuildErrors` in
# next.config.mjs disables the tsc type-check phase (it OOM-killed the build on
# this ~2 GB-RAM box). Types are gated pre-push instead (.githooks/pre-push →
# `npm run typecheck`), so nothing un-type-checked reaches here.
# Even compile-only, webpack can spike near the RAM limit, so we keep two guards:
#   1) Ensure a swap file exists — but ONLY as an emergency cushion, never as
#      something the heap is sized to fill.
#   2) Cap V8's old-space heap via NODE_OPTIONS sized from PHYSICAL RAM (not
#      RAM+swap). Sizing to swap makes V8 grow into swap and thrash the box to a
#      near-halt (a "stuck" 30-minute build). ~75% of physical RAM keeps the heap
#      resident in real memory; swap only catches transient spikes.
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  echo "      No swap detected — creating 4G swapfile..."
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
if [ -z "${NODE_OPTIONS:-}" ]; then
  mem_mb=$(free -m | awk '/^Mem:/{print $2}')
  # ~75% of PHYSICAL RAM, floored at 1536 MB. This scales up on bigger instances
  # (e.g. 3072 on 4 GB, 6144 on 8 GB) without ever telling V8 it may grow into swap.
  heap=$(( mem_mb * 3 / 4 ))
  [ "$heap" -lt 1536 ] && heap=1536
  export NODE_OPTIONS="--max-old-space-size=${heap}"
fi
echo "      NODE_OPTIONS=${NODE_OPTIONS}"
npm run build
# --update-env ensures all cluster workers pick up new env vars
pm2 restart ecosystem.config.js --update-env
pm2 save

echo ""
echo "=========================================="
echo "  Redeploy complete!"
echo "  Run 'pm2 status' to verify."
echo "=========================================="
