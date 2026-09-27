#!/usr/bin/env bash
# One command to run the frontend: installs deps on first run, starts Vite on :5173.
set -euo pipefail
cd "$(dirname "$0")/../frontend"
[ -d node_modules ] || npm install
exec npm run dev
