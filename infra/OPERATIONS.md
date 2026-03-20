# Elvis — Operations Guide

## First deploy (Hostinger VPS)

### 1. Prerequisites

```bash
# On the VPS — install Docker + Docker Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
docker compose version  # should print v2.x
```

### 2. Clone and configure

```bash
git clone <your-repo> /opt/elvis
cd /opt/elvis
cp .env.prod.example .env.prod
# Edit .env.prod with real values (see comments in the file)
```

### 3. Point DNS

Create an A record: `elvis.yourdomain.com → <VPS IP>`

Set `ELVIS_DOMAIN=elvis.yourdomain.com` in `.env.prod`.

### 4. Deploy

```bash
chmod +x scripts/*.sh
./scripts/deploy.sh
```

This will:
1. Build Docker images for api and worker
2. Start postgres and redis
3. Run `prisma migrate deploy` (safe, non-destructive)
4. Start all services including Caddy (auto-TLS)
5. Run smoke tests

### 5. Bootstrap OAuth tokens (first time only)

**Microsoft Graph (Outlook Calendar + Mail):**
```bash
docker compose -f docker-compose.prod.yml exec api \
  node -e "require('./dist/scripts/oauth-bootstrap.js').run()"
```

**Gmail:**
```bash
docker compose -f docker-compose.prod.yml exec api \
  node -e "require('./dist/scripts/gmail-oauth-bootstrap.js').run()"
```

---

## Routine operations

### Deploy new version

```bash
cd /opt/elvis
git pull
./scripts/deploy.sh
```

For zero-downtime (skip build step):
```bash
./scripts/deploy.sh --skip-build
```

### Check service health

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=50 api
docker compose -f docker-compose.prod.yml logs --tail=50 worker
./scripts/smoke-test.sh https://elvis.yourdomain.com
```

### Manual job trigger

```bash
curl -X POST https://elvis.yourdomain.com/jobs/briefing/trigger
curl -X POST https://elvis.yourdomain.com/jobs/weekly-report/trigger
```

---

## Backup and restore

### Manual backup

```bash
./scripts/backup.sh
ls backups/  # elvis_YYYYMMDD_HHMMSS.dump
```

### Schedule automatic backups (VPS cron)

```bash
crontab -e
# Add:
0 3 * * * /opt/elvis/scripts/backup.sh >> /var/log/elvis-backup.log 2>&1
```

### Restore a backup

```bash
./scripts/restore.sh backups/elvis_20260320_030000.dump
```

> **Warning:** This drops and recreates the database. Stop the api/worker first:
> ```bash
> docker compose -f docker-compose.prod.yml stop api worker
> ./scripts/restore.sh backups/elvis_20260320_030000.dump
> docker compose -f docker-compose.prod.yml start api worker
> ```

---

## Rollback

### Roll back to previous image tag

```bash
# Tag the current images before deploying (add to deploy.sh workflow)
docker tag elvis-api:latest elvis-api:previous
docker tag elvis-worker:latest elvis-worker:previous

# To rollback:
docker compose -f docker-compose.prod.yml stop api worker
docker tag elvis-api:previous elvis-api:latest
docker tag elvis-worker:previous elvis-worker:latest
docker compose -f docker-compose.prod.yml start api worker
```

### Roll back database migration

```bash
# Prisma doesn't support automatic rollback — restore from backup
./scripts/restore.sh backups/elvis_<LAST_GOOD_DATE>.dump
```

---

## Disabling features safely

| Feature | Env var | Effect |
|---------|---------|--------|
| All jobs | `JOBS_ENABLED=false` | Worker processes queue but skips execution |
| Email sending | `SEND_ENABLED=false` | All sends become dry-run |
| Webhook | `WEBHOOK_SECRET=` (unset) | All webhook requests return 401 |

---

## Alerts

The worker sends WhatsApp alerts (to `OWNER_PHONE`) for:
- **Job failures** — any BullMQ job that throws an error
- **Queue stuck** — waiting+active jobs > `QUEUE_STUCK_THRESHOLD` (default 20)
- **Failed job count** — when failed > 0 in queue (checked hourly)

Alerts are suppressed during quiet hours (22:00–07:00 BRT).

---

## Useful commands

```bash
# View all running containers
docker compose -f docker-compose.prod.yml ps

# Follow logs for all services
docker compose -f docker-compose.prod.yml logs -f

# Open psql shell
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U elvis -d elvis

# Redis CLI
docker compose -f docker-compose.prod.yml exec redis redis-cli

# Restart a single service
docker compose -f docker-compose.prod.yml restart api

# Full stop (keeps volumes)
docker compose -f docker-compose.prod.yml down

# Full stop + delete volumes (DESTRUCTIVE — loses all data)
docker compose -f docker-compose.prod.yml down -v
```
