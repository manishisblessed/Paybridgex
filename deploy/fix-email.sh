#!/bin/bash
cd /home/ubuntu/paybridgex
sed -i 's|EMAIL_FROM="onboarding@resend.dev"|EMAIL_FROM="noreply@paybridgex.in"|' .env
grep EMAIL_FROM .env
