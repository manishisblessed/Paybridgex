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
# `next build` (webpack + a TS type-check worker pool) peaks well above the
# ~2 GB RAM on the small production instance, so a naked `npm run build` gets
# OOM-killed mid type-check. Two protections:
#   1) Ensure a swap file exists so the kernel has runway beyond physical RAM.
#   2) Cap V8's old-space heap via NODE_OPTIONS, sized from RAM+swap so the same
#      script scales up automatically on a larger instance (and never shrinks a
#      value the operator set explicitly).
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
  swap_mb=$(free -m | awk '/^Swap:/{print $2}')
  # 60% of (RAM+swap), floored at 3584 MB, capped 1 GB below the total so the OS
  # and the type-check worker pool keep breathing room.
  budget=$(( (mem_mb + swap_mb) * 6 / 10 ))
  ceiling=$(( mem_mb + swap_mb - 1024 ))
  heap=$budget
  [ "$heap" -lt 3584 ] && heap=3584
  [ "$heap" -gt "$ceiling" ] && heap=$ceiling
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
