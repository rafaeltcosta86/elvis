#!/usr/bin/env bash
# deploy.sh — Build, migrate, and start prod services
# Usage: ./scripts/deploy.sh [--skip-build]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.prod.yml"

SKIP_BUILD=false
for arg in "$@"; do
  [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true
done

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting Elvis deploy"

if [[ "$SKIP_BUILD" == false ]]; then
  echo "--- Building images ---"
  $COMPOSE build --no-cache api worker
fi

echo "--- Starting infrastructure ---"
$COMPOSE up -d postgres redis
echo "--- Waiting for postgres to be healthy ---"
until $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER:-postgres}" > /dev/null 2>&1; do
  sleep 2
done

echo "--- Running database migrations ---"
$COMPOSE run --rm api sh -c "cd /app && node_modules/.bin/prisma migrate deploy"

echo "--- Starting all services ---"
$COMPOSE up -d

echo "--- Waiting for API to respond ---"
sleep 5
"$SCRIPT_DIR/smoke-test.sh" "${ELVIS_DOMAIN:-http://localhost}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy complete"
