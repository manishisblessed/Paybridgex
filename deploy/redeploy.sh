#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "  Paybridgex — Redeploy"
echo "=========================================="

cd /home/ubuntu/paybridgex

echo "[1/6] Pulling latest code..."
# This box is a pure mirror of origin/main — it never holds local commits or
# hand-edited tracked files. A plain `git pull` (merge) ABORTS whenever a file
# that is now tracked in the repo already exists here as an untracked file
# (e.g. an ad-hoc script created directly on the server, then later committed):
#   "error: The following untracked working tree files would be overwritten by merge"
# To make deploys idempotent and un-blockable, hard-reset the working tree to
# exactly match origin/main. This overwrites any such now-tracked files, while
# leaving genuinely untracked, un-committed files (.env, node_modules, build
# output, uploads) completely alone.
git fetch origin main
git reset --hard origin/main

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
# next.config.mjs disables the tsc type-check phase. Types are gated pre-push
# instead (.githooks/pre-push → `npm run typecheck`), so nothing un-type-checked
# reaches here. (This box now has 8 GB RAM, so tsc-in-build would fit — but the
# pre-push gate already covers it, so we keep the build lean and fast.)
#
# Two guards keep the webpack compile healthy:
#   1) Ensure a small swap file exists as a safety cushion. On this 8 GB box the
#      compile's working set (~1.6 GB, growing with the codebase) sits well
#      within physical RAM even with PM2 (live app + worker) running, so swap is
#      NOT part of the heap budget — it only catches rare transient spikes. Kept
#      small (2 GB) because the root disk is modest; do not size it to the heap.
#   2) Cap V8's old-space heap via NODE_OPTIONS at ~75% of PHYSICAL RAM so the
#      heap stays fully resident in real memory (no swap thrash). On 8 GB this
#      resolves to ~5.9 GB — far above the working set — and scales with the box.
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  echo "      No swap detected — creating 2G swapfile..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
if [ -z "${NODE_OPTIONS:-}" ]; then
  mem_mb=$(free -m | awk '/^Mem:/{print $2}')
  # ~75% of PHYSICAL RAM, floored at 2560 MB. On 8 GB this is ~5.9 GB (fully
  # resident, no swap). The floor only matters on much smaller boxes; larger
  # instances scale automatically and stay in physical RAM.
  heap=$(( mem_mb * 3 / 4 ))
  [ "$heap" -lt 2560 ] && heap=2560
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
