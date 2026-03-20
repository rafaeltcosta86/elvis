# Elvis Assistant — Implementation Plan (Técnico)

## 1) Estratégia de execução (TRAD vs COWORK + vibe coding)
- Regra: entregar spikes testáveis (30–60 linhas) antes de generalizar.
- TRAD (fora do Cowork): decisões, design, debugging investigativo, segurança/permissões, integrações sensíveis.
- COWORK: tarefas mecânicas multi-arquivo com aceite claro, escopo limitado e stop condition.
- Approval gates obrigatórios para ações de risco: enviar e-mail, criar/alterar evento, enviar msg a terceiros.

## 2) Arquitetura (visão geral)
### 2.1 Diagrama textual
[WhatsApp] 
  -> [NanoClaw Gateway]
     -> [Webhook Router API (Node/TS)]
        -> [Command/NLU Layer]
           -> [Domain Services]
              - Tasks Service
              - Daily Plan Service
              - Reminder/Scheduler Service
              - Email Service (Outlook + Gmail)
              - Calendar Service (Outlook)
              - User Model Service (learning)
           -> [DB: Postgres]
           -> [Queue/Scheduler: Redis + BullMQ]
           -> [Audit Log]
           -> [Optional Web UI Admin]

### 2.2 Componentes
1) NanoClaw: recepção de mensagens WhatsApp + repasse via webhook.
2) API Backend: roteamento, autenticação interna, domínio, integrações.
3) Worker: lembretes e rotinas (briefing/check-in/review), jobs de resumo, etc.
4) Banco: Postgres com migrations.
5) Redis: fila e agendamentos (BullMQ).
6) UI mínima (opcional): painel para tarefas, configs e audit.

## 3) Stack recomendada (decisão padrão)
- Node.js + TypeScript
- Postgres
- Redis + BullMQ
- ORM: Prisma
- Docker Compose (dev e prod)
- Reverse proxy: Caddy (HTTPS)
- UI (opcional): Next.js (painel simples)

## 4) Modelo de dados (mínimo viável)
### 4.1 Tabelas principais
- tasks
  - id, title, description, category, priority, tags(json), status, due_at, created_at, updated_at, source_channel
- reminders
  - id, task_id nullable, event_id nullable, remind_at, channel, status, created_at
- daily_plan
  - id, date, items(json list of task_ids/order), created_at, updated_at
- user_profile
  - id (single), timezone, quiet_hours, proactivity_level, explicit_prefs(json), inferred_prefs(json), confidence(json), updated_at
- communications
  - id, provider(outlook|gmail|whatsapp), type(summary|draft|send), thread_id, to, subject, body, status(draft|awaiting_approval|sent|canceled|dry_run), created_at, approved_at, metadata(json)
- oauth_tokens
  - id, provider, encrypted_token_blob, scopes, created_at, updated_at, expires_at
- audit_log (imutável)
  - id, ts, actor(user|system), action, entity_type, entity_id, summary, metadata(json)

### 4.2 Regras importantes
- Audit log nunca é atualizado/deletado (só append).
- Communications “sent” sempre tem “approval record” associado (pode ser no metadata).

## 5) Integrações
### 5.1 NanoClaw + WhatsApp
- Implementar um endpoint webhook para receber:
  - sender_id, message_text, message_id, timestamp, attachments
- Responder pelo NanoClaw com mensagens formatadas no “contrato UX”.
- Envio para terceiros:
  - se não suportado no MVP: gerar texto + botão/copiar e registrar.

### 5.2 Microsoft Graph (Outlook)
- OAuth flow e armazenamento criptografado de tokens.
- Calendar:
  - listar eventos do dia, semana atual e próxima
  - criar evento/reunião (sempre com preview e aprovação)
  - detectar conflito (slot ocupado)
- Mail:
  - buscar e-mails do dia, classificar “importantes”
  - gerar resumo e drafts

### 5.3 Gmail API
- OAuth e tokens criptografados.
- Buscar e-mails do dia, classificar “importantes”
- gerar resumo e drafts
- envio somente com aprovação

## 6) Segurança e privacidade
- Tokens OAuth criptografados em repouso:
  - AES-GCM com master key via env (ex.: `OAUTH_ENC_KEY`) e rotação planejada
- Secrets via env vars, nunca commitar
- “Approval gates”:
  - enviar e-mail
  - criar/alterar/deletar evento
  - enviar msg a terceiros
- “Dry-run mode”:
  - executa tudo, mas não envia/atualiza no provedor
- Log redaction: evitar conteúdo sensível no log estruturado

## 7) Observabilidade e operação
- Logs estruturados JSON com correlation id por conversa
- Endpoints: /health, /status
- Audit log para rastreabilidade
- Backups:
  - dump do Postgres diário + retenção
- Alertas simples:
  - falha de jobs, falha de OAuth refresh, fila travada

## 8) Rotinas e scheduler
### 8.1 Jobs recorrentes
- Briefing manhã (07:30): eventos do dia + top tarefas + riscos
- Check-in (13:30): somente se houver pendências relevantes
- Review (20:00): concluídas, pendências, sugestão de reagendamento
- Resumo e-mails (ex.: 18:00) ou sob demanda (/email)
- Anti-spam:
  - quiet hours (ex.: 22:00–07:00)
  - limite diário de nudges
  - backoff se ignorado

### 8.2 Lembretes
- Por tarefa (due_at / reminders)
- Por evento (Outlook)
- Estado: scheduled → sent → acknowledged/expired

## 9) Camada de “Aprendizado” (Wow incremental)
### 9.1 Sinais de aprendizado (MVP do wow)
- Comportamento:
  - concluiu / adiou / ignorou
  - horários preferidos para executar
  - categorias mais frequentes
- Comunicação:
  - e-mails “importantes” que o usuário abriu/mandou responder vs ignorou
- Preferências:
  - proactivity_level ajustado por feedback (“mais/menos proativo”)

### 9.2 Saídas
- Recomendação de prioridades no “Planejar meu dia”
- Ajuste de lembretes (horários/antecedência)
- Relatório semanal:
  - “aprendi X, vou mudar Y”
  - ações rápidas: “corrigir”, “não é isso”, “mais/menos”

## 10) Plano de repositório (sugestão)
- /apps/api (Express/Fastify)
- /apps/worker (BullMQ worker)
- /apps/admin (Next.js painel mínimo) [opcional]
- /packages/shared (schemas, types, utils)
- /infra (caddy, compose, scripts backup)
- /prisma (schema + migrations)
- PRD.md, implementation_plan.md, task.md

## 11) Milestones com critérios de aceite
### M1 — Base local (rodando)
Entregar:
- docker-compose (api, worker, postgres, redis)
- prisma migrations iniciais
- endpoints /health /status
Aceite:
- `docker compose up` sobe tudo
- `pnpm prisma migrate dev` (ou equivalente) roda ok
- /health responde 200

### M2 — Spike 30–60 linhas: tarefas mínimas
Entregar:
- POST /tasks (create)
- GET /tasks (list)
- scripts de teste no README (curl)
Aceite:
- cria e lista tarefas persistidas no Postgres

### M3 — Comandos do dia (sem WhatsApp)
Entregar:
- /today (planejar dia básico com tarefas)
- /done, /adiar
Aceite:
- fluxo funciona via curl/script, atualiza status e due_at

### M4 — Scheduler/worker + rotinas
Entregar:
- jobs briefing/check-in/review com anti-spam e quiet hours
Aceite:
- jobs disparam e logs mostram decisões; não spamma

### M5 — NanoClaw + WhatsApp
Entregar:
- webhook receiver + roteador de comandos
- respostas no formato UX (entendeu/fez/próximo)
Aceite:
- mensagem no WhatsApp cria tarefa e /hoje responde

### M6 — Outlook Calendar (Graph)
Entregar:
- OAuth + leitura eventos
- /semana
- criação de reunião com preview + aprovação
Aceite:
- /semana retorna eventos
- criação só ocorre após CONFIRMAR

### M7 — E-mail Outlook + Gmail
Entregar:
- /email resumo (2 provedores)
- drafts + envio com aprovação + dry-run
Aceite:
- resumo funciona
- envio só com aprovação explícita

### M8 — User Model (MVP do wow)
Entregar:
- preferências explícitas + inferidas com confiança
- relatório semanal “aprendi/vou mudar”
Aceite:
- recomendações mudam com comportamento e explicam o porquê

### M9 — Deploy Hostinger
Entregar:
- compose prod + Caddy HTTPS
- scripts de backup Postgres
- guia de operação e rollback
Aceite:
- instruções reproduzíveis de deploy

## 12) Patch operacional para Cowork (quando usar)
Quando um bloco for executado no Cowork:
- Trabalhar somente dentro da pasta do projeto
- Não deletar/mover arquivos fora de ./archive sem aprovação
- Para ações de risco: parar e pedir CONFIRMAR/CANCELAR
- Checkpoints por milestone: feito / como testar / próximos passos
- Se integrações estiverem incertas: começar com dry-run + mocks