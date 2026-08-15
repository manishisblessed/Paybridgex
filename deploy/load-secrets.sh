#!/bin/bash
set -euo pipefail

# =====================================================================
#  load-secrets.sh — hydrate .env.production from AWS at deploy time
# =====================================================================
#
#  Production secrets are NEVER committed to the repo or baked into the AMI.
#  They live in AWS and are pulled onto the box at deploy time by this script,
#  which writes a root-only .env.production that PM2 / Next.js then read.
#
#  Two supported backends (pick one with SECRETS_BACKEND):
#
#   1) ssm  — SSM Parameter Store (SecureString) under a path prefix.
#             Each app env var is a parameter, e.g.
#               /paybridgex/prod/NEXTAUTH_SECRET      (SecureString)
#               /paybridgex/prod/APP_ENCRYPTION_KEY   (SecureString)
#               /paybridgex/prod/BULKPE_TOKEN         (SecureString)
#               /paybridgex/prod/DATABASE_URL         (SecureString)
#             Put them there once with:
#               aws ssm put-parameter --name /paybridgex/prod/NEXTAUTH_SECRET \
#                 --type SecureString --value "$(openssl rand -base64 32)"
#
#   2) secretsmanager — a single JSON secret holding all key/value pairs, e.g.
#               aws secretsmanager create-secret --name paybridgex/prod \
#                 --secret-string '{"NEXTAUTH_SECRET":"...","APP_ENCRYPTION_KEY":"..."}'
#
#  The EC2 instance role must allow ssm:GetParametersByPath + kms:Decrypt
#  (or secretsmanager:GetSecretValue). No long-lived AWS keys on the box.
#
#  Usage:
#    SECRETS_BACKEND=ssm SSM_PREFIX=/paybridgex/prod AWS_REGION=ap-south-1 \
#      bash deploy/load-secrets.sh
# =====================================================================

SECRETS_BACKEND="${SECRETS_BACKEND:-ssm}"
SSM_PREFIX="${SSM_PREFIX:-/paybridgex/prod}"
SECRET_NAME="${SECRET_NAME:-paybridgex/prod}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
ENV_OUT="${ENV_OUT:-/home/ubuntu/paybridgex/.env.production}"

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not installed"; exit 1; }

umask 077  # ensure the file is created root/owner-only (600)
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "[secrets] Backend=$SECRETS_BACKEND region=$AWS_REGION -> $ENV_OUT"

if [ "$SECRETS_BACKEND" = "ssm" ]; then
  # Pull every parameter under the prefix; emit KEY="value" lines.
  aws ssm get-parameters-by-path \
    --region "$AWS_REGION" \
    --path "$SSM_PREFIX" \
    --with-decryption \
    --recursive \
    --query "Parameters[].[Name,Value]" \
    --output text | while IFS=$'\t' read -r name value; do
      key="${name##*/}"
      # Escape any double quotes in the value.
      printf '%s="%s"\n' "$key" "${value//\"/\\\"}" >> "$TMP"
    done
elif [ "$SECRETS_BACKEND" = "secretsmanager" ]; then
  command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required for secretsmanager backend"; exit 1; }
  aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" \
    --query SecretString --output text \
    | jq -r 'to_entries[] | "\(.key)=\"\(.value)\""' >> "$TMP"
else
  echo "ERROR: unknown SECRETS_BACKEND '$SECRETS_BACKEND' (use ssm|secretsmanager)"; exit 1
fi

if [ ! -s "$TMP" ]; then
  echo "ERROR: no secrets fetched — refusing to write an empty $ENV_OUT"; exit 1
fi

# Always-on baseline that is not a secret.
{
  echo "NODE_ENV=\"production\""
} >> "$TMP"

mv "$TMP" "$ENV_OUT"
chmod 600 "$ENV_OUT"
trap - EXIT
echo "[secrets] Wrote $(grep -c '=' "$ENV_OUT") variables to $ENV_OUT (mode 600)"
