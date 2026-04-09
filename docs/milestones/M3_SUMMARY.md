# M3 Summary — Today & Task Actions

## Overview

**Objetivo:** Implementar GET /today com categorização inteligente, POST /today/plan com upsert, e ações em tasks (/done, /postpone) com audit log

**Status:** ✅ Completo

**Padrão:** Spike — lógica direto nas rotas

## Arquivos Criados

```
apps/api/src/
├── schemas/
│   └── today.ts             (17 linhas) — PostPlanSchema, PostponeSchema
├── routes/
│   ├── tasks.ts             (177 linhas) — +/done, +/postpone
│   └── today.ts             (105 linhas) — GET /today, POST /today/plan
└── index.ts                 (atualizado) — registra todayRouter

apps/api/
└── package.json             (date-fns, date-fns-tz adicionados)
```

## Endpoints M3

### GET /today
```
Retorna: {
  date: "YYYY-MM-DD",
  overdue: Task[],      // due_at < hoje (não hoje)
  urgent: Task[],       // due_at = hoje OU priority = URGENT
  suggestions: Task[]   // até 7 tasks PENDING, ordenadas por priority DESC → due_at ASC
}
```

**Lógica:**
- **overdue:** `due_at < hoje AND status in [PENDING, IN_PROGRESS]`
- **urgent:** `(due_at = hoje OR priority = URGENT) AND NOT in overdue AND status PENDING/IN_PROGRESS`
- **suggestions:** resto das tasks, max 7, ordenadas por priority DESC → due_at ASC

**Timezone:** America/Sao_Paulo (date-fns-tz)

### POST /today/plan
```
Body: { items: [{ task_id: uuid, order: number }] }
Retorna: DailyPlan { id, date, items, ... }
```

**Lógica:**
- Upsert em DailyPlan (WHERE date = hoje)
- Rodar 2x com mesmo body = idempotente (não duplica)

### POST /tasks/:id/done
```
Retorna: Task { id, ..., status: "DONE", ... }
```

**Lógica:**
- Atualiza task.status = "DONE"
- Cria AuditLog entry: `{ action: "task.done", entity_type: "Task", entity_id: id }`
- Retorna 404 se task não encontrada

**Auditoria:**
```json
{
  "action": "task.done",
  "actor": "user",
  "entity_type": "Task",
  "entity_id": "<id>",
  "summary": "Task marked as done: <title>"
}
```

### POST /tasks/:id/postpone
```
Body: { to: "tomorrow" | "next_week" | "2026-04-15T00:00:00Z" }
Retorna: Task { id, ..., due_at: <new_date>, status: "PENDING" }
```

**Lógica:**
- `"tomorrow"` → hoje + 1 dia
- `"next_week"` → próxima segunda-feira
- ISO_date → parsear diretamente

**Timezone:** America/Sao_Paulo (date-fns-tz para calcular hoje/amanhã)

**Auditoria:**
```json
{
  "action": "task.postponed",
  "actor": "user",
  "entity_type": "Task",
  "entity_id": "<id>",
  "summary": "Task postponed to 2026-04-15"
}
```

## Handler Sizes (Spike Constraint)

| Handler | Linhas | Limit | % |
|---------|--------|-------|-----|
| GET /today | 50 | 60 | 83% ✓ |
| POST /today/plan | 23 | 60 | 38% ✓ |
| POST /tasks/:id/done | 31 | 60 | 52% ✓ |
| POST /tasks/:id/postpone | 49 | 60 | 82% ✓ |

Todos respeitam o spike constraint de ~60 linhas por handler.

## Validação (Zod)

### PostPlanSchema
```typescript
{
  items: [
    { task_id: uuid, order: int (positive) }
  ]
}
```

### PostponeSchema
```typescript
{
  to: enum["tomorrow", "next_week"] | ISO_datetime
}
```

## Error Handling

- **400:** Zod validation error (PostponeSchema)
- **404:** Task não encontrada em /done ou /postpone
- **500:** Database error

## Dependencies Adicionadas

- `date-fns@^2.30.0` — cálculos de data
- `date-fns-tz@^2.0.0` — suporte a timezone

## Arquitetura M1 + M2 + M3

```
apps/api/src/
├── lib/
│   ├── prisma.ts      ← PrismaClient singleton
│   └── redis.ts       ← IORedis singleton
├── routes/
│   ├── health.ts      ← GET /health
│   ├── status.ts      ← GET /status
│   ├── tasks.ts       ← POST/GET/PATCH /tasks + /done + /postpone
│   └── today.ts       ← GET /today + POST /today/plan
├── schemas/
│   ├── task.ts        ← CreateTaskSchema, UpdateTaskSchema, ListTasksQuerySchema
│   └── today.ts       ← PostPlanSchema, PostponeSchema
└── index.ts           ← Express app + router registration
```

## Restrições Respeitadas

✅ Sem Outlook Calendar integration (M6)
✅ Sem User Model ou inferred_prefs (M8)
✅ Sem middleware de autenticação
✅ Sem paginação elaborada
✅ Handlers respeitam ~60 linhas
✅ Audit log para todas as mutações
✅ Timezone America/Sao_Paulo aplicado

## Padrão Spike

Este é o padrão para **M3 spike:**

1. ✅ Lógica direto nas rotas (sem service layer ainda)
2. ✅ Validação Zod em input
3. ✅ Tratamento de erro simples
4. ✅ Timezone-aware calculations
5. ✅ Audit log automático para mutações

**M4+:** Se reutilização aumentar, refatorar para service/repository.

## Critério de Aceite

- ✅ GET /today retorna overdue, urgent, suggestions corretamente
- ✅ suggestions ordenadas por priority DESC → due_at ASC, max 7
- ✅ POST /today/plan upsert (rodar 2x = idempotente)
- ✅ POST /tasks/:id/done status="DONE" + audit log
- ✅ POST /tasks/:id/postpone com "tomorrow", "next_week", ISO_date
- ✅ 404 para id inexistente
- ✅ Handlers respeitam spike constraint (~60 linhas)
- ✅ Nenhuma rota M4+ criada (/semana, /email, scheduler)

## Próximos Passos (M4+)

- [ ] Refatorar para service layer (extrair lógica de categorização)
- [ ] Implementar /tasks/today (retorna TODAY tasks, não future)
- [ ] Adicionar paginação para sugestões
- [ ] Conectar ao Outlook Calendar (M6)
- [ ] User preferences (quiet hours, proactivity level) (M8)
- [ ] Scheduler para lembretes (M5)
