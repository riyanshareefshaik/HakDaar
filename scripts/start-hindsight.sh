#!/usr/bin/env bash
# Starts the self-hosted Hindsight server (API :8888, UI :9999) using Groq from .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env — copy .env.example to .env and add your GROQ_API_KEY"; exit 1; }
set -a; source .env; set +a

docker rm -f hindsight >/dev/null 2>&1 || true
docker run -d --pull always --name hindsight --restart unless-stopped --shm-size=1g \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=groq \
  -e HINDSIGHT_API_LLM_API_KEY="$GROQ_API_KEY" \
  -e HINDSIGHT_API_LLM_MODEL="${HINDSIGHT_LLM_MODEL:-openai/gpt-oss-20b}" \
  -e HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand \
  -e HINDSIGHT_API_WORKER_ID=hakdaar-local \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest

echo "Hindsight starting… API: http://localhost:8888  UI: http://localhost:9999"
echo "Follow logs with: docker logs -f hindsight"
