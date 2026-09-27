#!/usr/bin/env bash
# Puts HakDaar online at https://hakdaar.me from this Mac (Docker + Cloudflare Tunnel).
# Safe to run again: it reuses the existing secret, tunnel and DNS routes.
#
#   ./scripts/go-live.sh                 # hakdaar.me + www.hakdaar.me
#   DOMAIN=app.hakdaar.me ./scripts/go-live.sh
#
# Before the first run: hakdaar.me must be "Active" in Cloudflare (see DEPLOY.md, option B).
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-hakdaar.me}"
TUNNEL="${TUNNEL:-hakdaar}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. settings
[ -f .env ] || die "Missing .env. Run: cp .env.example .env  and put your Groq key in it."
grep -qE '^GROQ_API_KEY=gsk_[A-Za-z0-9]{20,}' .env || die "Put a real GROQ_API_KEY=gsk_... in .env first."

set_env() {  # set_env KEY VALUE  (replace the line if present, else append)
  if grep -qE "^$1=" .env; then
    grep -vE "^$1=" .env > .env.tmp && mv .env.tmp .env
  fi
  printf '%s=%s\n' "$1" "$2" >> .env
}
set_env SITE_ADDRESS ":80"
if ! grep -qE '^SESSION_SECRET=.{32,}' .env; then
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
  echo "Created a SESSION_SECRET in .env (keep it; changing it logs everyone out)."
fi

# ---------------------------------------------------------------- 2. the app
say "Starting HakDaar in Docker (first time: 3–5 minutes)…"
docker info >/dev/null 2>&1 || die "Docker is not running. Open Docker Desktop, wait for it to start, then run this again."
docker rm -f hindsight >/dev/null 2>&1 || true   # the dev memory container, if any
docker compose up -d --build

printf 'Waiting for the app'
for _ in $(seq 1 90); do
  if curl -fsS http://localhost/api/health >/dev/null 2>&1; then break; fi
  printf '.'; sleep 2
done
echo
curl -fsS http://localhost/api/health >/dev/null 2>&1 \
  || die "The app did not answer on http://localhost. Check: docker compose logs backend web"
echo "OK: http://localhost is up. (Hindsight may need another minute to finish starting.)"

# ---------------------------------------------------------------- 3. the tunnel
if ! command -v cloudflared >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || die "Install Homebrew first (https://brew.sh), then run this again."
  say "Installing cloudflared…"
  brew install cloudflared
fi

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  say "A browser window will open: click hakdaar.me, then Authorize."
  cloudflared tunnel login
fi

if ! cloudflared tunnel list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TUNNEL"; then
  say "Creating tunnel '$TUNNEL'…"
  cloudflared tunnel create "$TUNNEL"
fi

route() {
  local out
  if out=$(cloudflared tunnel route dns "$TUNNEL" "$1" 2>&1); then
    echo "DNS: $1 → tunnel"
  elif echo "$out" | grep -qi "already exists"; then
    die "Cloudflare already has a DNS record for $1 (probably the old GitHub Pages one).
Delete it in Cloudflare → hakdaar.me → DNS → Records, then run this script again."
  else
    die "Could not route $1: $out"
  fi
}
say "Pointing $DOMAIN at the tunnel…"
route "$DOMAIN"
[ "$DOMAIN" = "hakdaar.me" ] && route "www.hakdaar.me"

# ---------------------------------------------------------------- 4. go live
say "HakDaar is going live at https://$DOMAIN"
echo "Keep this window open. The Mac is kept awake while it runs. Press Ctrl+C to take the site offline."
exec caffeinate -dims cloudflared tunnel run --url http://localhost:80 "$TUNNEL"
