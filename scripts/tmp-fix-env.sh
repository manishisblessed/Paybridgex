#!/usr/bin/env bash
set -euo pipefail

F=/home/ubuntu/env-paybridgex

sed -i 's/\r$//' "$F"
sed -i 's|^NEXTAUTH_URL=.*|NEXTAUTH_URL="https://paybridgex.in"|' "$F"
sed -i 's|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL="https://paybridgex.in"|' "$F"
# NODE_ENV is managed by PM2/Next.js; a value here triggers a Next.js warning.
sed -i '/^NODE_ENV=/d' "$F"
# Payout cannot go live without BULKPE_TOKEN — fail closed.
if ! grep -qE '^[[:space:]]*BULKPE_TOKEN=.+' "$F"; then
  sed -i 's|^PARTNER_PAYOUT_ENABLED=.*|PARTNER_PAYOUT_ENABLED="false"|' "$F"
fi
# Point KYC video tooling at the system ffmpeg we just installed.
sed -i '/^FFMPEG_PATH=/d;/^FFPROBE_PATH=/d' "$F"
printf 'FFMPEG_PATH="/usr/bin/ffmpeg"\n' >> "$F"
printf 'FFPROBE_PATH="/usr/bin/ffprobe"\n' >> "$F"

chmod 600 "$F"

echo "--- non-secret URL/env lines ---"
grep -E '^(NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_APP_NAME|FFMPEG_PATH|FFPROBE_PATH)=' "$F"
echo "--- DB region check (expect ap-south-1) ---"
grep -E '^DATABASE_URL=' "$F" | grep -oE 'ap-[a-z]+-[0-9]' | head -1
echo "--- total keys ---"
grep -cE '^[A-Za-z_]+=' "$F"
