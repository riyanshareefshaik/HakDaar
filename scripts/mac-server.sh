#!/usr/bin/env bash
# Runs the whole HakDaar backend on this Mac and keeps https://hakdaar.vercel.app connected to it.
#
#   ./scripts/mac-server.sh
#
# What it does:
#   1. starts the backend + Hindsight memory in Docker
#   2. opens a free Cloudflare quick tunnel to it
#   3. publishes the tunnel's address to backend.json on GitHub (the website reads it on load,
#      so Vercel never needs changing)
#   4. keeps the Mac awake, and if the tunnel drops, opens a new one and publishes it again
# Leave this window open. Ctrl+C takes the site offline.
set -uo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks
[ -f .env ] || die "Missing .env. Run: cp .env.example .env  and put your Groq key in it."
grep -qE '^GROQ_API_KEY=gsk_' .env || die "Put a real GROQ_API_KEY=gsk_... in .env first."
if ! grep -qE '^SITE_ADDRESS=' .env; then echo 'SITE_ADDRESS=:80' >> .env; fi
if ! grep -qE '^SESSION_SECRET=.{32,}' .env; then
  echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
fi
docker info >/dev/null 2>&1 || die "Docker is not running. Open Docker Desktop, wait until it says running, then run this again."
if ! command -v cloudflared >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || die "Install Homebrew first (https://brew.sh), then run this again."
  say "Installing cloudflared…"
  brew install cloudflared || die "Could not install cloudflared."
fi

# ---------------------------------------------------------------- latest code
say "Getting the latest code…"
git checkout -q main 2>/dev/null || true
git pull -q --ff-only origin main || echo "(Could not update the code; continuing with what's here.)"

# ---------------------------------------------------------------- the app
say "Starting HakDaar in Docker (first time: 3–5 minutes)…"
docker compose up -d --build || die "Docker could not start the app. Check: docker compose logs"
printf 'Waiting for the app'
for _ in $(seq 1 120); do
  curl -fsS http://localhost/api/health >/dev/null 2>&1 && break
  printf '.'; sleep 2
done
echo
curl -fsS http://localhost/api/health >/dev/null 2>&1 || die "The app did not answer on http://localhost. Check: docker compose logs backend"
echo "OK: the app is running on this Mac."

# ---------------------------------------------------------------- publish the address
publish() {  # publish URL  -> writes backend.json and pushes it so the website finds the backend
  printf '{"api": "%s/api"}\n' "$1" > backend.json
  git add backend.json
  git commit -q -m "Point the website at the Mac backend" -- backend.json 2>/dev/null || true
  for i in 1 2 3 4; do
    git pull -q --rebase origin main >/dev/null 2>&1
    git push -q origin HEAD:main && { echo "Published. The website picks it up within ~5 minutes."; return 0; }
    sleep $((i * 2))
  done
  printf '\033[33mCould not push to GitHub. Set this in Vercel instead (Settings → Environment Variables), then Redeploy:\n  VITE_API_URL=%s/api\033[0m\n' "$1"
}

# ---------------------------------------------------------------- keep awake + tunnel forever
caffeinate -dimsu -w $$ &
LOG="$(mktemp -t hakdaar-tunnel)"
trap 'say "Stopping the tunnel. HakDaar is offline until you run this again."; kill 0' INT TERM

while true; do
  say "Opening the tunnel…"
  : > "$LOG"
  cloudflared tunnel --no-autoupdate --url http://localhost:80 >"$LOG" 2>&1 &
  TUNNEL_PID=$!
  URL=""
  for _ in $(seq 1 60); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | grep -v '^https://api\.' | head -1)
    [ -n "$URL" ] && break
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
  done
  if [ -z "$URL" ]; then
    echo "The tunnel did not start. Retrying in 10 seconds…"; tail -5 "$LOG"
    kill "$TUNNEL_PID" 2>/dev/null; sleep 10; continue
  fi
  say "HakDaar backend: $URL"
  publish "$URL"
  echo "Live site: https://hakdaar.vercel.app  (keep this window open; the Mac stays awake)"
  wait "$TUNNEL_PID"
  echo "The tunnel stopped. Reconnecting in 5 seconds…"; sleep 5
done
