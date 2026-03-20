# M4 Summary — BullMQ Worker + Cron Jobs

## Overview

**Objetivo:** Implementar 4 jobs recorrentes com BullMQ (briefing, check-in, review, email) com quiet hours, nudge limit e mock de envio

**Status:** ✅ Completo

**Padrão:** Worker spike — lógica direto nos jobs

## Arquivos Criados

```
apps/worker/src/
├── lib/
│   ├── quietHours.ts    (12 linhas) — isQuietHours(tz): boolean
│   ├── messenger.ts     (8 linhas) — sendMessage(to, text): void (mock)
│   ├── scheduler.ts     (82 linhas) — initScheduler() + BullMQ queue setup
│   └── prisma.ts        (17 linhas) — PrismaClient singleton
└── jobs/
    ├── briefing.ts      (73 linhas) — 07:30 diário
    ├── checkin.ts       (66 linhas) — 13:30 diário
    ├── review.ts        (67 linhas) — 20:00 diário
    └── emailSummary.ts  (61 linhas) — 18:00 diário

apps/api/src/
└── routes/
    └── jobs.ts          (36 linhas) — POST /jobs/:name/trigger
```

## 4 Cron Jobs

### Briefing (07:30)
```
Busca: overdue + urgent tasks
Texto: "Bom dia! Hoje: X eventos, Y tarefas urgentes. Top 3: ..."
Checks: quiet hours → nudge limit → sendMessage
```

### Check-in (13:30)
```
Busca: urgent PENDING tasks
Anti-spam: skip se nenhuma
Texto: "Check-in 13:30 — ainda pendente: ..."
Checks: quiet hours → nudge limit
```

### Review (20:00)
```
Busca: count completed + pending
Texto: "Review do dia — concluídas: X. Pendentes: Y."
Checks: quiet hours → nudge limit
```

### Email Summary (18:00)
```
Mock data: "3 e-mails importantes (mock)"
Checks: quiet hours → nudge limit
```

## Lógica Comum (todos os jobs)

### 1. Quiet Hours
```typescript
isQuietHours(tz) → true se 22:00–07:00
Log: "[SKIP quiet hours] <job>"
```

### 2. Nudge Limit
```typescript
// Lê UserProfile.daily_nudge_limit (default 5)
// Conta AuditLog.action com "nudge" de hoje
if (todayNudges >= dailyLimit) {
  Log: "[SKIP limit] <job> (X/5 nudges today)"
  return
}
```

### 3. Anti-spam (Check-in apenas)
```typescript
// Skip se não há urgent pending
if (urgentPending.length === 0) {
  Log: "[SKIP no pending urgent] checkin"
  return
}
```

### 4. Mock Messenger
```typescript
sendMessage(ownerPhone, text)
// Loga: "[MOCK] enviaria para 551199999999: <texto>"
// Futuro: será NanoClaw client
```

### 5. Audit Log
```typescript
await prisma.auditLog.create({
  action: "nudge.briefing" | "nudge.checkin" | "nudge.review" | "nudge.email",
  actor: "system",
  entity_type: "Job",
  summary: "Briefing/Check-in/Review/Email enviado"
})
```

## Cron Patterns (BullMQ com timezone)

```typescript
// Todos com tz: "America/Sao_Paulo"

briefing:    "30 7 * * *"   → 07:30 diário
checkin:     "30 13 * * *"  → 13:30 diário
review:      "0 20 * * *"   → 20:00 diário
emailSummary: "0 18 * * *"  → 18:00 diário
```

## Variáveis de Ambiente

```
OWNER_PHONE=551199999999  # número do dono para mock
JOBS_ENABLED=true         # desabilita tudo se false
```

## Endpoint de Teste

```
POST /jobs/:name/trigger

Valid names: briefing | checkin | review | emailSummary

Response:
{
  "status": "triggered",
  "jobId": "...",
  "jobName": "briefing"
}
```

## Scheduler Setup (BullMQ)

```typescript
// apps/worker/src/index.ts
redis.on('connect', async () => {
  console.log('worker ready');
  await initScheduler(
    briefingJob,
    checkinJob,
    reviewJob,
    emailSummaryJob
  );
});
```

Logs esperados:
```
worker ready
scheduler initialized
4 cron jobs registered: briefing (07:30), checkin (13:30), review (20:00), emailSummary (18:00)
```

## Dependências Adicionadas

```json
{
  "bullmq": "^5.0.0",
  "date-fns": "^2.30.0",
  "date-fns-tz": "^2.0.0"
}
```

## Restrições Respeitadas

✅ Quiet hours implementado (22:00–07:00)
✅ Nudge limit consultado de UserProfile
✅ Anti-spam no check-in
✅ Timezone America/Sao_Paulo
✅ JOBS_ENABLED flag funcional
✓ Sem NanoClaw (mock apenas)
✓ Sem backoff/retry (será M8)
✓ Sem email real (mock)
✓ Sem modificação schema.prisma

## Arquitetura M1 + M2 + M3 + M4

```
apps/
├── api/
│   ├── src/
│   │   ├── lib/ (prisma, redis)
│   │   ├── routes/ (health, status, tasks, today, jobs)
│   │   ├── schemas/ (task, today)
│   │   └── index.ts
│   └── package.json
└── worker/
    ├── src/
    │   ├── lib/ (prisma, redis, quietHours, messenger, scheduler)
    │   ├── jobs/ (briefing, checkin, review, emailSummary)
    │   └── index.ts
    └── package.json

prisma/
├── schema.prisma (7 modelos)
└── migrations/ (init + trigger)
```

## Critério de Aceite

- ✅ Worker logs "worker ready", "scheduler initialized", "4 cron jobs registered"
- ✅ Trigger briefing → worker logs "[MOCK] enviaria para..."
- ✅ Trigger checkin sem urgent → worker logs "[SKIP no pending urgent]"
- ✅ isQuietHours(22:00-07:00) retorna true
- ✅ daily_nudge_limit consultado e respeitado
- ✅ JOBS_ENABLED=false desabilita todos os jobs
- ✅ AuditLog criado automaticamente para cada envio

## Próximos Passos (M5+)

- [ ] Scheduler de lembretes (M5)
- [ ] Backoff/retry logic (M8)
- [ ] NanoClaw integration (M6)
- [ ] User preferences (M8)
- [ ] Email real (M9)
