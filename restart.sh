#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

docker compose up --build -d

for attempt in $(seq 1 30); do
  if docker compose exec -T server wget -qO- http://127.0.0.1:4000/health >/dev/null; then
    echo "DHIS2 Data Manager is ready: http://localhost:3000"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "Server did not become healthy. Recent logs:"
docker compose logs --tail=100 server
exit 1