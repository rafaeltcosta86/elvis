# Elvis Assistant — Decisões de Arquitetura e Toolchain

> Atualizar sempre que uma decisão for revisada. Incluir data e justificativa.

---

## Stack principal

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Framework HTTP | **Express** | Familiar, ecossistema amplo, suficiente para o MVP |
| Runtime | **Node 22 LTS** | Versão LTS atual com melhor performance e suporte a ES2024 |
| Linguagem | **TypeScript** | Tipagem + suporte a monorepo com pnpm |
| ORM | **Prisma** | Migrations versionadas, type-safe, bom DX |
| Fila / Scheduler | **BullMQ + Redis** | Confiável para jobs recorrentes e lembretes |
| DB | **Postgres 16** | Relacional, suporta Json columns, confiável |

---

## Estrutura de repositório

```
apps/api/          ← Express API
apps/worker/       ← BullMQ worker
packages/shared/   ← tipos, schemas, utils compartilhados
infra/             ← Caddy, scripts de operação
prisma/            ← schema.prisma + migrations
```

> `apps/admin` (Next.js): **adiado para M9+**. Não incluir no scaffold inicial.

---

## Docker Compose — portas

| Serviço  | Porta host | Porta container |
|----------|-----------|-----------------|
| API      | 3000      | 3000            |
| Postgres | 5433      | 5432            |
| Redis    | 6380      | 6379            |

---

## Tooling

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Package manager | **pnpm workspaces** | |
| Linter | **ESLint flat config** (`eslint.config.mjs`) — ESLint 9+ | |
| Formatter | **Prettier** | |
| Docker base image | `node:22-alpine` | |
| Test framework | **Vitest 2.x** | Jest requer mais config TS; Vitest é nativo ESM/TS, mais rápido, API compatível com Jest |

---

## NLU / Parsing de comandos (M5)

- **Escolha: Regex + parsing estruturado (MVP simples)**
- Comandos fixos: `/hoje`, `/done <id>`, `/adiar <id> <data>`, `/semana`, `/email`
- Texto livre → regex de captura de tarefa + fallback para "não entendi"
- Motivo: zero custo, zero latência extra, suficiente para o conjunto de comandos do MVP
- Revisitar para LLM apenas se o volume de intenções ambíguas justificar o custo

---

## Segurança

- Tokens OAuth: AES-GCM com master key via env (`OAUTH_ENC_KEY`)
- Secrets: somente via variáveis de ambiente, nunca commitar
- Approval gates obrigatórios: enviar e-mail, criar/alterar evento, msg para terceiros

---

## Schema Prisma — decisões (Bloco 3)

| Campo | Decisão | Justificativa |
|-------|---------|---------------|
| `tasks.category` | `String` + validação Zod no app | Flexível para adicionar categorias sem migration |
| `tasks.priority` | Enum `LOW\|MEDIUM\|HIGH\|URGENT` | Tipagem segura, ordenável |
| `tasks.tags` | `Json` (array de strings) | Simples, sem join, suficiente para MVP |
| `oauth_tokens.encrypted_token_blob` | `String` (base64 AES-GCM) | Mais fácil de inspecionar/debugar |
| `audit_log` imutabilidade | Trigger Postgres via migration SQL custom | Garantia no banco, não depende de disciplina do app |
| `DailyPlan.date` | `String` (`"YYYY-MM-DD"`) | Evita ambiguidade de timezone |
| `UserProfile` | Single-row, criado on-demand na 1ª requisição | Sem seed necessário |

---

## M4 — Scheduler/worker (Bloco 8)

| Decisão | Escolha |
|---------|---------|
| Envio de mensagens nos jobs (pré-M5) | Mock/log — job monta mensagem e loga `[MOCK] enviaria: ...` |
| Briefing | 07:30 |
| Check-in | 13:30 |
| Review | 20:00 |
| Resumo e-mails | 18:00 |
| Quiet hours | 22:00–07:00 |

---

## M6 — Outlook Calendar (Bloco 12 [TRAD], 2026-03-16)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| OAuth flow Microsoft Graph | **Device Code Flow** | App pessoal single-tenant; sem UI; token inicial raro; zero infra de redirect |
| Biblioteca Graph API | **axios direto** (já no projeto) | Escopo pequeno (eventos do dia/semana); não vale overhead do SDK oficial |
| OAUTH_ENC_KEY formato | **32 bytes hex** (64 chars) | `openssl rand -hex 32`; fácil de inspecionar, AES-GCM 256-bit |
| Mock strategy em testes | **`vi.mock`** (Vitest nativo) | Unit tests puros; zero deps extras; suficiente para oauthService e rotas de calendário |

**Crypto:** AES-GCM, chave 32 bytes hex, IV aleatório por criptografia, armazenar como `iv:ciphertext` (ambos hex) na coluna `encrypted_token_blob`.

**Bootstrap OAuth (1ª vez):**
1. Rodar `pnpm --filter api ts-node src/scripts/oauth-bootstrap.ts`
2. Script imprime URL + device code no terminal
3. Usuário autoriza no browser
4. Script persiste token no banco criptografado

### POST /calendar/events (Bloco 15 [TRAD], 2026-03-16)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Approval gate | `dry_run: false` no body | Simplicidade; gate de negócio fica no WhatsApp bot (preview → confirma → reenvia com `dry_run:false`) |
| Conflict detection | Query `GET /me/calendarView` com janela proposta; `value.length > 0` = conflito | Sem heurísticas de deslocamento por ora; conflito informativo (não bloqueia criação) |
| Reminders | Campo `reminders: number[]` no body (minutos antes), default `[1440, 120]` | Graph API aceita apenas 1 reminder por evento; usar `Math.min(...reminders)` para `reminderMinutesBeforeStart` |
| Endpoint Graph | `POST /me/events` | Standard Graph Calendar API |

**Request:** `{ title, start (ISO), duration_min, dry_run? (default true), location?, reminders? }`

**Response dry_run true:** `{ preview: { title, start, end, location }, action: "dry_run", conflicts: [] }`

**Response dry_run false:** `{ event: { id, title, start, end }, action: "created", conflicts: [] }`

---

## M7 — E-mail Outlook + Gmail (Bloco 17 [TRAD], 2026-03-19)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Gmail OAuth flow | **Localhost loopback redirect** (`redirect_uri=http://localhost:<PORT>`) | Google deprecated OOB flow em 2022; loopback é o padrão para apps Desktop single-user |
| Tipo de app Google Cloud | **Desktop app** | Sem UI web; permite loopback redirect; escopos `gmail.readonly` + `gmail.send` |
| Biblioteca Gmail | **`googleapis` npm** | Cliente oficial Google; gerencia refresh de token via `OAuth2Client`; mesma lib para outros Google APIs no futuro |
| Token Google — formato no blob | **JSON** `{access_token, refresh_token, expiry_date}` criptografado como blob AES-256-GCM | Google exige refresh_token persistido para renovar o access_token; Microsoft só precisa do access_token |
| oauthService — extensão | Adicionar `storeTokenForProvider(provider, blob)` + `getTokenForProvider(provider)` **sem quebrar** `storeToken`/`getToken` existentes | Backward compat com M6; 9 testes existentes continuam verdes |
| Classificação de importância | **3 sinais determinísticos**: domínio em `KNOWN_CONTACT_DOMAINS` (env), keyword em `IMPORTANT_KEYWORDS` (env), `isReply=true` | Zero ML no MVP; configurável por env; totalmente unit-testável como função pura |
| Erros no summary | **502 se qualquer provedor falhar** (sem resultados parciais) | Evita confusão com resumos incompletos; revisitar em M8 |
| SEND_ENABLED flag | `process.env.SEND_ENABLED !== 'true'` (default = bloqueado) | Safe by default: env ausente ou mal digitada bloqueia envios reais |
| Shared service | `lib/emailService.ts` exporta `getEmailSummary()` usada por route e webhook | Sem HTTP self-call; reutilização direta via import |

**Bootstrap Gmail (1ª vez):**
1. Criar credencial "Desktop app" no Google Cloud Console com escopos `gmail.readonly` + `gmail.send`
2. Definir `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`
3. Rodar `pnpm --filter api ts-node src/scripts/gmail-oauth-bootstrap.ts`
4. Script inicia servidor HTTP local, imprime URL de autorização
5. Usuário autoriza no browser → script troca code por tokens → persiste blob JSON criptografado para `provider=GOOGLE`

---

## M8 — User Model / "Wow factor" (Bloco 24 [TRAD], 2026-03-19)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Sinais capturados | `task.done` + `task.postponed` (já no AuditLog); `task.created` para relatório semanal | Sinais de alta qualidade já persistidos; sem custo extra |
| Inferência de horário preferido | Hora do dia (0–23) dos eventos `task.done` nos últimos 30 dias; bucket por período | Simples, determinístico, testável como função pura |
| Inferência de categoria top | Contagem de `task.done` por `category` via join com Task por `entity_id` → top-3 | Aproveita dado já existente sem nova coluna |
| Confidence score | `{ data_points: N, last_updated: ISO, sufficient: boolean }` — threshold mínimo 5 eventos | Evita recomendações prematuras; usuário vê progresso |
| Quando rodar inferência | On-demand em `GET /user/profile` + ao fim de cada `weeklyReportJob` | Sem custo adicional de job assíncrono no MVP |
| Proactivity level | Escala 1–5 (default 3); `/mais-proativo` += 1, `/menos-proativo` -= 1, clamped 1–5 | Controle granular; suficiente para MVP |
| Email signal | `[-]` adiado para M9+ — requer read-receipt integration (Graph/Gmail) | Alta complexidade, sinal fraco no MVP |
| Relatório semanal | Domingo 20:00 BRT; formato WhatsApp amigável; mock/log se NanoClaw não configurado | Consistente com outros jobs do scheduler |

**Períodos do dia:**
- Manhã: 6–11h
- Tarde: 12–17h
- Noite: 18–22h
- Desconhecido: fora ou dados insuficientes

---

## M9 — Deploy Hostinger (Bloco 30 [TRAD], 2026-03-20)

### docker-compose.prod.yml

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Bind mounts de código | **Nenhum** — imagens pré-compiladas pelo Dockerfile | Produção nunca expõe código-fonte no filesystem do host |
| Restart policy | `unless-stopped` para todos os serviços | Auto-recovery em falhas; para manualmente com `docker compose stop` |
| Env vars | `env_file: .env.prod` no topo do compose | Secrets em arquivo separado, nunca commitar; `.env.prod.example` documenta as chaves |
| Network mode | Bridge network interna `elvis_prod` | API e worker falam com postgres/redis pelo nome do serviço |
| Caddy | Serviço extra no compose, mapeando 80 e 443 pro host | Gerencia TLS Let's Encrypt automaticamente; forward port 80/443 → api:3000 |
| Volumes | `postgres_data_prod` + `redis_data_prod` para persistência | Separados dos volumes de dev |
| Migrations em prod | `prisma migrate deploy` como entrypoint condicional na imagem da API | `migrate deploy` aplica migrations pendentes sem reset; seguro para CI/CD |
| Health checks | Reaproveitados do compose dev (postgres e redis) | Evita api/worker subir antes do banco estar pronto |

### Caddy (reverse proxy + TLS)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Config | `infra/Caddyfile` — `<DOMAIN> { reverse_proxy api:3000 }` | Mínimo para TLS automático + proxy |
| TLS | Let's Encrypt automático via ACME (padrão Caddy) | Zero config manual; renovação automática |
| Volume | `caddy_data` e `caddy_config` para persistir certificados entre restarts | Evita rate-limit do Let's Encrypt |

### Alertas

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Job failure | BullMQ `queue.on('failed')` global no worker → `nanoclawClient.sendMessage()` | Reutiliza canal existente; alerta chega no WhatsApp do usuário |
| OAuth refresh failure | `oauthService.getToken/getTokenForProvider` lança erro → worker catches + envia alerta | Ponto de falha crítico para calendário e e-mail |
| Fila travada | Job `queueHealthCheck` a cada 1h: conta `waiting+active > QUEUE_STUCK_THRESHOLD` (default 20) → alerta | Threshold configurável via env |
| Silenciamento | Alerts respeitam quiet hours (22:00–07:00) do nanoclawClient | Consistente com resto do sistema |

### Backup

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Ferramenta | `pg_dump` via `docker exec` do container postgres | Sem dependências extras; dump custom format (-Fc) comprime melhor |
| Retenção | 7 dias — `find backups/ -mtime +7 -delete` | Balance entre segurança e espaço em disco |
| Destino | `$PROJECT_ROOT/backups/` no host | Simples; usuário responsável por replicar para S3/Dropbox se necessário |
| Agendamento | Cron do VPS: `0 3 * * * /opt/elvis/scripts/backup.sh` | Às 03:00 UTC, baixo tráfego |
| Restauração | `pg_restore -d elvis < backups/YYYYMMDD.dump` | Documentado no guia de operação |

### Scripts de operação

| Script | Função |
|--------|--------|
| `scripts/backup.sh` | Dump Postgres + retenção 7 dias |
| `scripts/restore.sh` | Restaura dump específico |
| `scripts/smoke-test.sh` | Valida /health, /status, /today após deploy |
| `scripts/deploy.sh` | Pull imagens → migrate deploy → docker compose up -d |

---

## Revisões futuras (pontos em aberto)

- ~~Validação de assinatura do webhook NanoClaw~~ → **resolvido:** Bearer token simples (`Authorization: Bearer <WEBHOOK_SECRET>` via env). Revisar se NanoClaw suportar HMAC no futuro.
- ~~Critério exato de "tarefa urgente" para o `/today`~~ → **resolvido:** urgente = `due_at <= hoje` OU `priority = URGENT` (qualquer status PENDING/IN_PROGRESS)
- Política de categorias padrão e correção rápida pelo usuário (antes de M2)
