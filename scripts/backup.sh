#!/usr/bin/env bash
# backup.sh — Postgres daily backup with 7-day retention
# Usage: ./scripts/backup.sh
# Cron (VPS): 0 3 * * * /opt/elvis/scripts/backup.sh >> /var/log/elvis-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_ROOT/backups"
DATE="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/elvis_$DATE.dump"

# Load .env.prod if DATABASE_URL not already set
if [[ -z "${DATABASE_URL:-}" && -f "$PROJECT_ROOT/.env.prod" ]]; then
  set -a
  source "$PROJECT_ROOT/.env.prod"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-elvis}"

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup → $BACKUP_FILE"

# Run pg_dump inside the postgres container
docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup done: $BACKUP_FILE ($SIZE)"

# Prune backups older than 7 days
find "$BACKUP_DIR" -name "elvis_*.dump" -mtime +7 -delete
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Old backups pruned (>7 days)"
