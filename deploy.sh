#!/bin/bash
set -euo pipefail

# ── Paybridgex — Production Deploy ────────────────────────────────────
# Usage:  ./deploy.sh
# Stores production .env at ~/env-paybridgex (outside the repo) so
# git pull never clobbers secrets. Every deploy copies it in fresh.
# ──────────────────────────────────────────────────────────────────────

APP_DIR="/home/ubuntu/paybridgex"
ENV_SOURCE="/home/ubuntu/env-paybridgex"
# Use the REPO's ecosystem file (always current with the code) — it defines
# BOTH the web app and the background worker, so a deploy restarts both.
ECOSYSTEM="$APP_DIR/ecosystem.config.js"
LOG_DIR="/home/ubuntu/logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step=0
total=7

log() { step=$((step+1)); echo -e "\n${CYAN}[${step}/${total}]${NC} ${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}✖  $1${NC}"; exit 1; }

START=$(date +%s)

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Paybridgex — Production Deploy${NC}"
echo -e "${CYAN}  $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"

# ── Pre-flight checks ────────────────────────────────────────────────

if [ ! -d "$APP_DIR/.git" ]; then
  fail "No git repo found at $APP_DIR"
fi

if [ ! -f "$ENV_SOURCE" ]; then
  fail "Production env file not found at $ENV_SOURCE\n   Create it once:  cp $APP_DIR/.env $ENV_SOURCE\n   Then edit $ENV_SOURCE with production values."
fi

mkdir -p "$LOG_DIR"

# ── Step 1: Pull latest code ─────────────────────────────────────────

log "Pulling latest code from origin/main..."
cd "$APP_DIR"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  warn "Already up-to-date ($(git rev-parse --short HEAD)). Continuing anyway..."
else
  git reset --hard origin/main
  echo "  Updated: $(git rev-parse --short "$LOCAL") → $(git rev-parse --short HEAD)"
fi

# ── Step 2: Copy production .env ──────────────────────────────────────

log "Copying production .env..."
cp "$ENV_SOURCE" "$APP_DIR/.env"
echo "  Copied from $ENV_SOURCE"

# ── Guard: the database MUST be the Mumbai project (ap-south-1) ────────
# The Tokyo project (ap-northeast-1) was retired. If a deploy ever points
# production at it again, local (Mumbai) and prod writes split across two
# databases and data silently goes missing (schemes not showing, etc.).
# Fail hard here BEFORE migrations/build/restart. Emergency override:
#   ALLOW_TOKYO_DB=1 ./deploy.sh
db_url_line=$(grep -E '^[[:space:]]*DATABASE_URL=' "$APP_DIR/.env" | tail -n 1 || true)
if [ -z "$db_url_line" ]; then
  fail "DATABASE_URL is missing from $APP_DIR/.env — refusing to deploy."
fi
if echo "$db_url_line" | grep -q "ap-northeast-1"; then
  if [ "${ALLOW_TOKYO_DB:-0}" = "1" ]; then
    warn "DATABASE_URL points at the retired Tokyo project (ap-northeast-1) — continuing because ALLOW_TOKYO_DB=1."
  else
    fail "DATABASE_URL points at the retired Tokyo project (ap-northeast-1).\n   Production must use the Mumbai project (ap-south-1).\n   Fix $ENV_SOURCE, then redeploy. Override only if you REALLY mean it:\n     ALLOW_TOKYO_DB=1 ./deploy.sh"
  fi
elif echo "$db_url_line" | grep -q "ap-south-1"; then
  echo "  DB region OK: ap-south-1 (Mumbai)"
else
  warn "DATABASE_URL region is neither ap-south-1 nor ap-northeast-1 — double-check $ENV_SOURCE points at the intended database."
fi

# ── Step 3: Install dependencies ─────────────────────────────────────

log "Installing dependencies (npm ci)..."
npm ci --production=false 2>&1 | tail -3

# ── Step 4: Generate Prisma client ────────────────────────────────────

log "Generating Prisma client..."
npx prisma generate

# ── Step 5: Sync database schema ─────────────────────────────────────

log "Applying database migrations..."
npx prisma migrate deploy

# ── Step 6: Build ─────────────────────────────────────────────────────

log "Building Next.js app..."
npm run build 2>&1 | tail -5

# ── Step 7: Restart PM2 ──────────────────────────────────────────────

log "Restarting PM2 processes..."
# startOrRestart restarts every app defined in the ecosystem file (and starts
# any that aren't running yet). The worker loads TypeScript at boot via tsx —
# if it is not restarted here it keeps executing the OLD code from memory, so
# NEVER restart only the web app.
pm2 startOrRestart "$ECOSYSTEM" --update-env
# Belt-and-braces: fail loudly if the worker somehow didn't come back fresh.
pm2 restart paybridgex-worker --update-env >/dev/null 2>&1 \
  || warn "paybridgex-worker restart failed — check 'pm2 status' manually!"
pm2 save

echo ""
pm2 list

END=$(date +%s)
ELAPSED=$((END - START))

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete in ${ELAPSED}s${NC}"
echo -e "${GREEN}  Commit: $(git rev-parse --short HEAD)${NC}"
echo -e "${GREEN}  Run 'pm2 logs' to verify startup${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
