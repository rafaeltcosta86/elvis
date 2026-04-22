# Elvis Assistant — task.md

> **Fonte de verdade do backlog.** Atualizar após cada Work Block concluído.
>
> **Como atualizar:** marque `[x]` nos checkboxes concluídos, adicione entrada no Log.
>
> **Status:** `[ ]` pendente · `[x]` concluído · `[~]` em andamento · `[!]` bloqueado · `[-]` cancelado/adiado

---

## Visão rápida
Assistente pessoal estilo Jarvis via WhatsApp (pt-BR) que evita esquecimentos de tarefas, eventos e comunicações. Single-tenant, Hostinger VPS, Node 22 + Express + TypeScript + Postgres + Redis + BullMQ + NanoClaw.

---

## Fases

### M1 — Base local (rodando)

**Epic: Infraestrutura e scaffold inicial**

- [x] Criar monorepo com pnpm workspaces (`apps/api`, `apps/worker`, `packages/shared`, `infra`, `prisma`)
- [x] Docker Compose: serviços api, worker, postgres:16-alpine, redis:7-alpine
- [x] Configurar TypeScript base (tsconfig por app, paths)
- [x] Configurar ESLint flat config (`eslint.config.mjs`) + Prettier
- [x] Prisma: schema inicial com tabelas core (tasks, reminders, daily_plan, user_profile, communications, oauth_tokens, audit_log)
- [x] Executar `prisma migrate dev` sem erros
- [x] Endpoint `GET /health` retorna `{ status: "ok" }`
- [x] Endpoint `GET /status` retorna versão + uptime + status dos serviços

**Critérios de aceite:**
```bash
docker compose up -d
curl http://localhost:3000/health  # → { "status": "ok" }
curl http://localhost:3000/status  # → { "version": "...", "uptime": ..., "db": "ok", "redis": "ok" }
pnpm --filter api prisma migrate status  # → All migrations applied
```

**Riscos / rollback:**
- Risco: conflito de portas locais → portas mapeadas no compose: Postgres=5433, Redis=6380
- Rollback: `docker compose down -v` descarta volumes

---

### M2 — Spike: tarefas mínimas (30–60 linhas)

**Epic: CRUD de tarefas**

- [x] `POST /tasks` — criar tarefa (title, description, category, priority, due_at, source_channel)
- [x] `GET /tasks` — listar tarefas com filtros básicos (status, category)
- [x] `PATCH /tasks/:id` — atualizar status/due_at
- [x] Validação de input (Zod)
- [x] Testes de fumaça (curl) documentados no README

**Critérios de aceite:**
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Pagar fatura","category":"casa","priority":"high","due_at":"2025-01-20"}'
# → { "id": "...", "title": "Pagar fatura", "status": "pending" }

curl http://localhost:3000/tasks
# → [ { "id": "...", ... } ]
```

**Riscos / rollback:**
- Spike deve ser 30–60 linhas por endpoint; não generalizar ainda
- Rollback: reverter migration + deletar arquivos de rota

---

### M3 — Comandos do dia (sem WhatsApp)

**Epic: Planejamento diário (HTTP)**

- [x] `GET /today` — retorna tarefas vencidas + urgentes + sugestão de 3–7 prioridades
- [x] `POST /today/plan` — criar/atualizar lista "Hoje" com task_ids ordenados
- [x] `POST /tasks/:id/done` — marcar como concluído + audit_log entry
- [x] `POST /tasks/:id/postpone` — adiar (`{ "to": "tomorrow" | "next_week" | ISO_date }`)
- [x] daily_plan registrado no Postgres

**Critérios de aceite:**
```bash
curl http://localhost:3000/today
# → { "date": "...", "overdue": [...], "urgent": [...], "suggestions": [...] }

curl -X POST http://localhost:3000/tasks/UUID/done
# → { "id": "...", "status": "done" }

curl -X POST http://localhost:3000/tasks/UUID/postpone -d '{"to":"tomorrow"}'
# → { "id": "...", "due_at": "<tomorrow>" }
```

**Riscos / rollback:**
- Lógica de "urgente" requer decisão de negócio → bloco [TRAD] antes de implementar
- Rollback: endpoints são aditivos

---

### M4 — Scheduler / worker + rotinas

**Epic: Jobs recorrentes + anti-spam**

- [x] BullMQ worker conectado ao Redis
- [x] Job: Briefing manhã (07:30) — eventos do dia + top tarefas + riscos
- [x] Job: Check-in (13:30) — só se houver pendências relevantes
- [x] Job: Review (20:00) — concluídas, pendências, sugestão de reagendamento
- [x] Job: Resumo e-mails (18:00 ou sob demanda)
- [x] Quiet hours (22:00–07:00): jobs não disparam mensagens
- [x] Limite diário de nudges (configurável em user_profile)
- [-] Backoff se ignorado (adiado para M8 — junto com User Model)
- [x] Logs estruturados por job com correlation_id

**Critérios de aceite:**
```bash
curl -X POST http://localhost:3000/jobs/briefing/trigger
# logs: "briefing job executed"

curl http://localhost:3000/status
# → { "queues": { "scheduler": { "waiting": 0, "active": 0, "failed": 0 } } }
```

**Riscos / rollback:**
- Não conectar WhatsApp real ainda (mock/log only)
- Rollback: `JOBS_ENABLED=false`

---

### M5 — NanoClaw + WhatsApp

**Epic: Canal WhatsApp (webhook + roteador)**

- [x] `POST /webhook/nanoclaw` — recebe mensagens + valida Bearer token
- [x] Parser de comandos (regex + parsing estruturado): `/hoje`, `/done X`, `/adiar X`, `/semana`, `/email`
- [x] Texto livre → captura de tarefa (regex de intenção)
- [x] Roteador de intenções → domain services
- [x] Resposta no contrato UX (entendeu / fez / próximo passo)
- [x] Envio de resposta via NanoClaw API (com fallback mock)
- [x] Tratamento de erro com mensagem amigável ao usuário

**Critérios de aceite:**
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"551199999999","message_text":"Lembrar de pagar a fatura amanhã","message_id":"msg_001","timestamp":1700000000}'
# → tarefa criada no banco; resposta enviada ao NanoClaw (log confirma ou mock 200)
```

**Riscos / rollback:**
- Validar assinatura do webhook (segurança) → [TRAD] obrigatório antes
- Envio para terceiros: fallback = logar sem enviar
- Rollback: desabilitar endpoint via feature flag

---

### M6 — Outlook Calendar (Microsoft Graph)

**Epic: Calendário Outlook**

- [x] OAuth flow Microsoft Graph (authorization_code + refresh)
- [x] Tokens criptografados (AES-GCM) em oauth_tokens
- [x] `GET /calendar/today` — lista eventos do dia
- [x] `GET /calendar/week` — lista eventos semana atual + próxima
- [x] `POST /calendar/events` — criar reunião (dry-run default + aprovação obrigatória)
- [x] Detecção de conflito de slot
- [x] Lembretes configuráveis (default: 1 dia + 2 horas antes)

**Critérios de aceite:**
```bash
curl http://localhost:3000/calendar/week
# → { "this_week": [...], "next_week": [...] }

curl -X POST http://localhost:3000/calendar/events \
  -d '{"title":"Reunião com João","start":"2025-01-20T15:00:00","duration_min":30,"dry_run":true}'
# → { "preview": {...}, "action": "dry_run", "conflicts": [] }
```

**Riscos / rollback:**
- Tokens OAuth: nunca logar, sempre encriptar antes de persistir
- Criação de evento real: approval gate obrigatório (CONFIRMAR no WhatsApp)
- Rollback: revogar token Microsoft + deletar de oauth_tokens

---

### M7 — E-mail Outlook + Gmail

**Epic: E-mail (resumo + drafts + envio com aprovação)**

- [x] OAuth Gmail API + tokens criptografados
- [x] Outlook Mail via Microsoft Graph (reusar tokens do M6)
- [x] Buscar e-mails do dia dos 2 provedores
- [x] Classificar "importantes" (critérios: regras + sinal de abertura/resposta)
- [x] `/email` — resumo diário com explicação de critérios
- [x] Geração de drafts de resposta
- [x] Envio somente com CONFIRMAR + registro em communications + audit_log
- [x] Dry-run mode (`DRY_RUN=true`)

**Critérios de aceite:**
```bash
curl -X POST http://localhost:3000/email/summary
# → { "outlook": { "important": [...], "total": N }, "gmail": { "important": [...], "total": N } }

DRY_RUN=true curl -X POST http://localhost:3000/email/send \
  -d '{"communication_id":"...","confirmed":true}'
# → { "status": "dry_run", "would_send_to": "..." }
```

**Riscos / rollback:**
- Nunca enviar sem approval record no banco
- Dry-run como default até validação completa
- Rollback: `SEND_ENABLED=false`

---

### M8 — User Model (MVP do "wow")

**Epic: Aprendizado e proatividade**

- [x] Capturar sinais: concluiu / adiou (AuditLog já registrava; `task.created` adicionado)
- [x] Inferir horários preferidos (padrão de uso)
- [x] Inferir categorias mais frequentes
- [-] Aprendizado de e-mails "importantes" (abriu/respondeu vs ignorou) — adiado para M9+
- [x] proactivity_level ajustável por feedback do usuário
- [x] Recomendações no `/today` baseadas em inferred_prefs
- [x] Relatório semanal domingo 20:00: "aprendi X, vou mudar Y"
- [x] Ações rápidas: `/corrigir`, `/mais-proativo`, `/menos-proativo`

**Critérios de aceite:**
```bash
curl http://localhost:3000/user/profile
# → { "inferred_prefs": { "preferred_hours": [...], "top_categories": [...] }, "confidence": {...} }

curl -X POST http://localhost:3000/jobs/weekly-report/trigger
# → mensagem WhatsApp com relatório (log/mock)
```

**Riscos / rollback:**
- Relatório semanal + botões de correção são safety net contra drift
- Rollback: zerar inferred_prefs sem afetar explicit_prefs

---

### M9 — Deploy Hostinger

**Epic: Produção + operação**

- [x] Docker Compose prod (sem bind mounts de código)
- [x] Caddy reverse proxy + HTTPS (Let's Encrypt)
- [x] `.env.prod` (nunca commitar) — `.env.prod.example` documenta as chaves; `.gitignore` protege
- [x] Script backup Postgres diário + retenção 7 dias
- [x] Alertas: falha de jobs, OAuth refresh, fila travada
- [x] Guia de operação: deploy, rollback, restauração (`infra/OPERATIONS.md`)
- [x] Smoke test pós-deploy (script curl)
- [-] `apps/admin` (Next.js painel mínimo) — adiado (opcional, pós-MVP)

**Critérios de aceite:**
```bash
docker compose -f docker-compose.prod.yml up -d
curl https://DOMINIO/health  # → { "status": "ok" }
bash scripts/smoke-test.sh   # → todos os checks passam
bash scripts/backup.sh && ls backups/  # → arquivo .dump de hoje
```

**Riscos / rollback:**
- Nunca commitar `.env.prod` ou chaves
- Rollback: image tag anterior + `docker compose up -d`
- Restaurar: `pg_restore -d elvis < backups/YYYYMMDD.dump`

---

### M10 — WhatsApp Approval Gate

**Epic: Human-in-the-Loop para envio de WhatsApp a terceiros**

> **Contexto:** Em 2026-04-09, a hipótese central do MVP foi validada: o comando `SEND_TO` existe e funciona (ex: "manda para assistente: já terminei a reunião"). No entanto, o `ai-blueprints.md` exige `approval_record_id` antes de qualquer escrita externa, e o WhatsApp envia imediatamente sem approval gate — violando a Invariante #1. M10 corrige essa lacuna trazendo WhatsApp para paridade com o fluxo de e-mail.

- [ ] Quando `SEND_TO` é acionado, criar registro `Communication` (status: `AWAITING_APPROVAL`, channel: `WHATSAPP`)
- [ ] Responder ao owner com preview: _"Vou mandar para [nome]: '[msg]'. Confirma? /confirm [id] ou /cancel [id]"_
- [ ] Implementar intent `CONFIRM` no commandParser (ex: "/confirm 42")
- [ ] Implementar intent `CANCEL` no commandParser (ex: "/cancel 42")
- [ ] Só enviar a mensagem real após `/confirm` — verificar `approval_record_id` no banco
- [ ] Atualizar `Communication.status` → `SENT` ou `CANCELLED` + entrada no `audit_log`
- [ ] Testes: tentativa de envio sem confirmação, confirmação, cancelamento, id inválido

**Critérios de aceite:**
```bash
# 1. Comando → sem envio imediato, recebe preview
curl -X POST /webhook/nanoclaw -d '{"message":"manda para assistente: teste"}'
# → "Vou mandar para assistente: 'teste'. Confirma? /confirm 1 ou /cancel 1"

# 2. Confirmação → envia
curl -X POST /webhook/nanoclaw -d '{"message":"/confirm 1"}'
# → "✉️ Mensagem enviada para assistente"

# 3. audit_log registra a ação
curl GET /status  # confirmar sem erros
```

**Riscos / rollback:**
- Verificar que `WHATSAPP_CONTACTS` e `WHATSAPP_ALLOWLIST` têm o número da assistente em produção
- Rollback: reverter webhook.ts para envio direto se approval gate introduzir regressão

---

### M11 — Contatos em DB + Atalhos Semânticos

**Epic: UX fluída para envio de mensagens a contatos**

> Hipótese: o fluxo `manda para Linic: <msg>` pode ser simplificado para `/linic <msg>` e o Elvis deve aprender novos atalhos a partir de linguagem natural sem formato fixo.

- [x] Tabela `Contact` no Prisma (id, name, phone, aliases[], created_at)
- [x] Migration `add_contact_table` aplicada
- [x] `contactService.ts` — findByAlias, findByName, addAlias, createContact, listContacts
- [x] `llmService.ts` — classifyIntent via Groq (llama-3.3-70b, free tier)
- [x] `commandParser.ts` — intent ALIAS_SHORTCUT (`/linic <msg>`)
- [x] Webhook — ALIAS_SHORTCUT: resolve alias no banco → cria draft → pede confirmação
- [x] Webhook — CREATE_TASK: chama LLM antes de criar tarefa; se REGISTER_ALIAS → persiste alias
- [x] `.env.prod.example` — documenta GROQ_API_KEY
- [x] 175 testes passando (21 novos), sem regressões

**Critérios de aceite:**
```bash
# 1. Cadastrar contato (seed manual ou via psql)
# INSERT INTO "Contact" (id, name, phone, aliases) VALUES (gen_random_uuid(), 'Linic', '5511988880000', ARRAY['/linic']);

# 2. Atalho rápido
curl -X POST /webhook/nanoclaw -d '{"message":"/linic olá tudo bem"}'
# → preview "📋 Vou mandar para Linic: 'olá tudo bem'. Confirma?"

# 3. Aprendizado semântico
curl -X POST /webhook/nanoclaw -d '{"message":"de agora em diante /li é a Linic"}'
# → "✅ Registrado! Agora /li = Linic."

# 4. Usar novo atalho
curl -X POST /webhook/nanoclaw -d '{"message":"/li oi"}'
# → preview de confirmação
```

---

### M12 — Suporte a Áudio (Backlog)

**Epic: Receber e processar mensagens de voz do WhatsApp**

> Custo estimado: $0 no free tier do Groq (Whisper Large v3) para até 100 msg/dia com 50% voz.

- [ ] Receber payload de áudio OGG do webhook NanoClaw/Baileys
- [ ] Transcrever via Groq Whisper (`whisper-large-v3`, free tier)
- [ ] Passar transcrição ao `handleIncomingWhatsApp` como texto normal
- [ ] Testar com mensagens de voz reais no WhatsApp

---

## Definições

### O que é "feito" (Definition of Done)
1. Todos os checkboxes da fase marcados `[x]`
2. Critérios de aceite executados com sucesso
3. Sem erros em `pnpm lint` e `pnpm build`
4. Entrada adicionada no Log
- [ ] Novos comportamentos têm teste automatizado (unit ou integration)

### Como testar

> **Workflow TDD (a partir de M6):**
> 1. Red — escreva o teste. Rode: `pnpm -r run test` (deve falhar)
> 2. Green — implemente o mínimo para passar
> 3. Refactor — limpe sem quebrar testes
>
> Acceptance criteria são testes automatizados; curl serve apenas para smoke test manual.

- **API:** comandos `curl` de cada fase
- **Worker/jobs:** endpoint de trigger + logs estruturados
- **Integrações:** sempre dry-run antes de envio real
- **WhatsApp:** simular via `curl POST /webhook/nanoclaw`

### Como rodar (local)
```bash
pnpm install
docker compose up -d
pnpm --filter api prisma migrate dev
pnpm --filter api dev      # porta 3000
pnpm --filter worker dev
pnpm lint && pnpm build
```

### Convenções de categoria
`casa` · `trabalho` · `pessoas` · `investimentos` · `saúde` · `outros`

### Approval gates obrigatórios
- Enviar e-mail real
- Criar / alterar / deletar evento no calendário
- Enviar mensagem WhatsApp para terceiros

---

## Log

| Data | O que foi concluído |
|------|---------------------|
| 2026-03-11 | Bloco 1 [TRAD] concluído: decisões de arquitetura e toolchain registradas em `DECISIONS.md` |
| 2026-03-11 | Bloco 2 [COWORK] concluído: scaffold monorepo pnpm + docker-compose 4 serviços (api, worker, postgres, redis) |
| 2026-03-11 | Bloco 3 [TRAD] concluído: schema Prisma revisado e aprovado, decisões registradas em `DECISIONS.md` |
| 2026-03-11 | Bloco 4 [COWORK] concluído: schema.prisma criado, migrations aplicadas (init + audit_log_immutable), /health e /status funcionando — **M1 completo** ✅ |
| 2026-03-11 | Bloco 5 [COWORK] concluído: POST/GET/PATCH /tasks com validação Zod — **M2 completo** ✅ |
| 2026-03-11 | Bloco 6 [TRAD] concluído: critério de urgente definido (due_at <= hoje OU priority=URGENT) |
| 2026-03-11 | Bloco 7 [COWORK] concluído: GET /today, POST /today/plan, /done, /postpone + audit_log — **M3 completo** ✅ |
| 2026-03-11 | Bloco 8 [TRAD] concluído: horários de jobs definidos + estratégia mock para pré-M5 |
| 2026-03-11 | Bloco 9 [COWORK] concluído: BullMQ worker + 4 jobs + quiet hours + nudge limit + mock sender — **M4 completo** ✅ (backoff adiado para M8) |
| 2026-03-11 | Bloco 10 [TRAD] concluído: autenticação webhook definida (Bearer token) |
| 2026-03-11 | Bloco 11 [COWORK] concluído: webhook NanoClaw + parser regex + roteador + nanoclawClient — **M5 completo** ✅ |
| 2026-03-16 | XP+TDD Foundation [TRAD+COWORK]: Vitest instalado, 9 testes (commandParser) passando, DoD atualizado |
| 2026-03-16 | Bloco 12 [TRAD] concluído: decisões OAuth M6 registradas (Device Code Flow, axios direto, AES-GCM hex, vi.mock) |
| 2026-03-16 | Bloco 13 [COWORK+TRAD fix] concluído: oauthService.ts + graphClient.ts + tests (schema fix: microsoftOAuthToken→oAuthToken), Prisma gerado, build limpo — 17 testes passando |
| 2026-03-16 | Bloco 14 [COWORK+TRAD fix] concluído: GET /calendar/today + GET /calendar/week + 10 testes supertest — 27 testes passando, build limpo |
| 2026-03-17 | Bloco 15 [TRAD] concluído: decisões POST /calendar/events registradas em DECISIONS.md (dry_run, conflito, reminders, endpoint Graph) |
| 2026-03-17 | Bloco 16 [COWORK+TRAD fix] concluído: POST /calendar/events + 9 testes (fix timezone wall-clock) — **36 testes passando, M6 completo** ✅ |
| 2026-03-19 | Bloco 17 [TRAD] concluído: decisões M7 registradas em DECISIONS.md (Gmail OAuth loopback, token JSON blob, SEND_ENABLED flag, shared emailService) |
| 2026-03-19 | Bloco 18 [COWORK] concluído: oauthService.ts estendido com storeTokenForProvider + getTokenForProvider (backward compat) — 42 testes |
| 2026-03-19 | Bloco 19 [COWORK] concluído: emailClassifier.ts (função pura, 3 sinais) + types/email.ts — 53 testes |
| 2026-03-19 | Bloco 20 [COWORK] concluído: outlookMailClient.ts (listTodayEmails + sendEmail via Graph) — 62 testes |
| 2026-03-19 | Bloco 21 [COWORK] concluído: gmailClient.ts (createGmailClient + listTodayEmails + sendEmail) + gmail-oauth-bootstrap.ts — 72 testes |
| 2026-03-19 | Bloco 22 [COWORK] concluído: emailService.ts + routes/email.ts (summary, draft, send + AuditLog) + montagem em index.ts — 100 testes |
| 2026-03-19 | Bloco 23 [COWORK] concluído: EMAIL intent no webhook.ts conectado a getEmailSummary() — **104 testes passando, M7 completo** ✅ |
| 2026-03-20 | Bloco 24 [TRAD] concluído: decisões M8 registradas em DECISIONS.md (sinais, inferência, confidence, proactivity, email adiado) |
| 2026-03-20 | Bloco 25 [COWORK] concluído: lib/userModel.ts (inferPreferences, computeConfidence, getOrCreateProfile, updateInferredPrefs) + 19 testes |
| 2026-03-20 | Bloco 26 [COWORK] concluído: routes/user.ts (GET /user/profile + POST /user/profile/feedback) + 11 testes + montagem em index.ts |
| 2026-03-20 | Bloco 27 [COWORK] concluído: GET /today retorna campo `recommendations` (active, message, preferred_period, top_categories) + 5 testes |
| 2026-03-20 | Bloco 28 [COWORK] concluído: commandParser + 3 novos intents (MORE_PROACTIVE, LESS_PROACTIVE, RESET_PREFS) + webhook 3 novos cases + 4 testes |
| 2026-03-20 | Bloco 29 [COWORK] concluído: weeklyReport.ts (computeWeeklyStats, formatWeeklyReport, weeklyReportJob) + scheduler Sun 20:00 + 11 testes worker — **143 API + 11 worker testes, M8 completo** ✅ |
| 2026-03-20 | Bloco 30 [TRAD] concluído: decisões M9 registradas em DECISIONS.md (prod compose, Caddy, alertas, backup, scripts) |
| 2026-03-20 | Bloco 31 [COWORK] concluído: docker-compose.prod.yml + infra/Caddyfile |
| 2026-03-20 | Bloco 32 [COWORK] concluído: scripts/backup.sh + scripts/restore.sh + scripts/smoke-test.sh + scripts/deploy.sh |
| 2026-03-20 | Bloco 33 [COWORK] concluído: alertService.ts (job failures + queue health) + scheduler queueHealthCheck hourly + 7 testes worker — **143 API + 18 worker testes** |
| 2026-03-20 | Bloco 34 [COWORK] concluído: .env.prod.example + infra/OPERATIONS.md + .gitignore — **M9 completo** ✅ |
| 2026-04-09 | [TRAD] Hipótese MVP validada: SEND_TO funciona (commandParser + webhook + whatsappService + adapters). Gap identificado: WhatsApp sem approval gate viola Invariante #1. M10 definido para corrigir. |
| 2026-04-10 | M11 [COWORK] concluído: Contact table + migration, contactService, llmService (Groq), ALIAS_SHORTCUT, aprendizado semântico de atalhos — **175 testes passando** ✅ |
| 2026-04-17 | Performance: Moved dayMap instantiation outside resolveDate in webhook.ts to reduce GC pressure.
| 2026-04-11 | PDLC [COWORK] concluído: Automação upstream via marcadores HTML e trigger do Jules para `spec:approved` — **231 testes passando** ✅ |
| 2026-04-17 | Sentinel [COWORK] concluído: Automação de issues architecture-violation para o board PDLC (coluna 💡 Ideia) usando PROJECT_TOKEN. |
