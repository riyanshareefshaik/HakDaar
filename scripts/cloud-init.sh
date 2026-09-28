#!/bin/bash
# HakDaar: one-paste server setup. No SSH needed.
#
# Paste this whole file into the setup-script box when creating an Ubuntu 24.04 server with 4 GB RAM:
#   DigitalOcean: Advanced options → Add Initialization scripts
#   Google Cloud: Advanced options → Management → Automation → Startup script
#   Azure: Advanced → Custom data
# Change only the two lines below. About 10 minutes after the server starts, HakDaar's backend
# answers at  https://<server-ip-with-dashes>.sslip.io/api/health
# Progress log on the server: /var/log/hakdaar-setup.log
set -euo pipefail

GROQ_API_KEY="PASTE_YOUR_GROQ_KEY_HERE"      # gsk_...
WEBSITE="https://hakdaar.vercel.app"          # where the website is hosted

# Some providers (e.g. Google Cloud startup scripts) run this on every boot: set up only once.
# Docker restarts HakDaar by itself after a reboot.
[ -d /opt/HakDaar ] && exit 0

exec > /var/log/hakdaar-setup.log 2>&1
echo "== HakDaar setup started $(date)"

# Room for the image builds on a 4 GB server
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

git clone https://github.com/riyanshareefshaik/HakDaar.git /opt/HakDaar
cd /opt/HakDaar

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
HOST="${IP//./-}.sslip.io"
cat > .env <<EOF
GROQ_API_KEY=$GROQ_API_KEY
GROQ_MODEL=openai/gpt-oss-120b
HINDSIGHT_LLM_MODEL=openai/gpt-oss-20b
SITE_ADDRESS=$HOST
CORS_ORIGINS=$WEBSITE
SESSION_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env

docker compose up -d --build

echo "https://$HOST/api" > /root/HAKDAAR_API_URL.txt
echo "== Done $(date). Set VITE_API_URL in Vercel to: https://$HOST/api"
