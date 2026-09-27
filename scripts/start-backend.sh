#!/usr/bin/env bash
# One command to run the backend: creates the venv on first run, installs deps, starts uvicorn.
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
exec uvicorn app.main:app --reload --port 8000
