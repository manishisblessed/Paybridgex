#!/bin/bash
# Normalize any legacy URL in the production .env to the final domain.
cd /home/ubuntu/paybridgex
sed -i 's|http://65.0.202.152|https://paybridgex.in|g' .env
grep -E 'APP_URL|NEXTAUTH_URL' .env
