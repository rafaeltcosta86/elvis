#!/usr/bin/env bash
# restore.sh — Restore a Postgres backup
# Usage: ./scripts/restore.sh backups/elvis_20260320_030000.dump

set -euo pipefail

DUMP_FILE="${1:-}"
if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: $0 <dump_file>"
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Error: dump file not found: $DUMP_FILE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env.prod if DATABASE_URL not already set
if [[ -z "${DATABASE_URL:-}" && -f "$PROJECT_ROOT/.env.prod" ]]; then
  set -a
  source "$PROJECT_ROOT/.env.prod"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-elvis}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restoring $DUMP_FILE → $POSTGRES_DB"

# Drop and recreate DB, then restore
docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $POSTGRES_DB;"
docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -c "CREATE DATABASE $POSTGRES_DB;"

docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$DUMP_FILE"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore complete"
