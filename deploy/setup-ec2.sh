#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "  Paybridgex EC2 Setup — Ubuntu 26.04"
echo "=========================================="

# 1. System updates
echo "[1/7] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS via NodeSource
echo "[2/7] Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

# 3. Install PM2 globally
echo "[3/7] Installing PM2..."
sudo npm install -g pm2

# 4. Install Nginx + AWS CLI (for pulling prod secrets from SSM/Secrets Manager)
echo "[4/7] Installing Nginx + AWS CLI..."
sudo apt install -y nginx unzip jq
sudo systemctl enable nginx
if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install --update
fi

# 5. Create app directory and logs
echo "[5/7] Setting up directories..."
mkdir -p /home/ubuntu/paybridgex
mkdir -p /home/ubuntu/logs

# 6. Clone the repo
echo "[6/7] Cloning repository..."
if [ -d "/home/ubuntu/paybridgex/.git" ]; then
    echo "Repo already exists, pulling latest..."
    cd /home/ubuntu/paybridgex && git pull origin main
else
    git clone https://github.com/manishisblessed/paybridgex.git /home/ubuntu/paybridgex
fi

# 7. Install dependencies
echo "[7/7] Installing npm dependencies..."
cd /home/ubuntu/paybridgex
npm ci --production=false

echo ""
echo "=========================================="
echo "  Base setup complete!"
echo "  Next steps:"
echo "  1. Load secrets from AWS (DO NOT create .env.production by hand):"
echo "       SECRETS_BACKEND=ssm SSM_PREFIX=/paybridgex/prod AWS_REGION=ap-south-1 \\"
echo "         bash deploy/load-secrets.sh"
echo "     (requires an EC2 instance role with ssm:GetParametersByPath + kms:Decrypt"
echo "      — or secretsmanager:GetSecretValue. No static AWS keys on the box.)"
echo "  2. Run: npx prisma generate"
echo "  3. Run: npx prisma migrate deploy"
echo "  4. Run: npm run build"
echo "  5. Configure Nginx (TLS via certbot; see deploy/nginx-paybridgex.conf)"
echo "  6. Start PM2 (app + worker)"
echo ""
echo "  Security reminders:"
echo "  - APP_ENCRYPTION_KEY / NEXTAUTH_SECRET / JWT_SECRET / BULKPE_* live ONLY"
echo "    in AWS (SSM SecureString / Secrets Manager), never in git or the AMI."
echo "  - Put Cloudflare (or AWS WAF + CloudFront) in front of this box; restrict"
echo "    the security group so :3000 is reachable only from Nginx/localhost."
echo "  - See SECURITY.md for the full control mapping."
echo "=========================================="
