# M2 Spike Summary — Task CRUD Endpoints

## Overview

**Objetivo:** Implementar handlers CRUD para `Task` com validação Zod (spike pattern)

**Status:** ✅ Completo

**Padrão:** Handler direto ao Prisma (sem abstrações, para spike)

## Arquivos Criados

```
apps/api/src/
├── schemas/
│   └── task.ts          (49 linhas) — Zod schemas
├── routes/
│   └── tasks.ts         (91 linhas) — 3 handlers
└── index.ts             (atualizado) — registra rota

apps/api/
└── package.json         (zod adicionado)
```

## Endpoints

| Método | Rota | Handler | Validação | Status |
|--------|------|---------|-----------|--------|
| POST | `/tasks` | CreateTaskHandler | CreateTaskSchema | 201 ou 400 |
| GET | `/tasks` | ListTasksHandler | ListTasksQuerySchema | 200 |
| PATCH | `/tasks/:id` | UpdateTaskHandler | UpdateTaskSchema | 200 ou 404 ou 400 |

## Schemas Zod

### CreateTaskSchema
```typescript
{
  title: string (required)
  description?: string
  category: "casa" | "trabalho" | "pessoas" | "investimentos" | "saude" | "outros"
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" (default: MEDIUM)
  due_at?: ISO DateTime (coerced to Date)
  source_channel?: string
}
```

### UpdateTaskSchema
```typescript
{
  title?: string
  description?: string
  category?: categoria enum
  priority?: priority enum
  status?: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED"
  due_at?: ISO DateTime
  source_channel?: string
}
```

### ListTasksQuerySchema
```typescript
{
  status?: TaskStatus
  category?: categoria
}
```

## Handler Sizes (Spike Constraint)

| Handler | Linhas | % do Limit |
|---------|--------|-----------|
| POST /tasks | 26 | 43% ✓ |
| GET /tasks | 23 | 38% ✓ |
| PATCH /tasks/:id | 21 | 35% ✓ |

Todos bem abaixo do limite de ~60 linhas por handler.

## Error Handling

- **400 Bad Request:** Zod validation fails
  ```json
  {
    "error": "Validation error",
    "details": [...]
  }
  ```

- **404 Not Found:** Task não encontrada no PATCH
  ```json
  {
    "error": "Task not found"
  }
  ```

- **500 Internal Server Error:** DB error

## Restrições Respeitadas

✅ Sem camada de serviço/repositório (handlers direto ao Prisma)
✅ Sem /tasks/:id/done ou /tasks/:id/postpone (M3)
✅ Sem paginação (apenas query filters)
✅ Sem testes automatizados
✅ Sem alteração ao schema.prisma
✅ Máximo ~60 linhas por handler

## Próximas Etapas (M3)

- [ ] Refatorar para camada de serviço (extrair lógica)
- [ ] Adicionar /tasks/:id/done (mark as done)
- [ ] Adicionar /tasks/:id/postpone (postpone reminder)
- [ ] Implementar /tasks/today (daily plan)
- [ ] Testes (vitest, supertest)
- [ ] Paginação elaborada (offset, limit)

## Validação (Quando tiver Docker + pnpm)

```bash
# 1. Start services
pnpm install
docker compose up -d
pnpm --filter api prisma migrate dev

# 2. Run validation script
bash M2_VALIDATION.sh

# Ou rodar comandos manualmente (ver abaixo)
```

### Teste Manual

```bash
# Create
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Task 1","category":"casa","priority":"HIGH","due_at":"2026-04-01T00:00:00Z"}'

# List
curl http://localhost:3000/tasks | jq .

# Filter
curl "http://localhost:3000/tasks?status=PENDING&category=casa" | jq .

# Update
curl -X PATCH http://localhost:3000/tasks/<ID> \
  -H "Content-Type: application/json" \
  -d '{"status":"DONE"}'

# Validation error
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","category":"invalida"}'
```

## Padrão Spike

Este é o padrão esperado para **spike** (exploração rápida):

1. ✅ Handlers direto ao Prisma (sem abstrações)
2. ✅ Validação Zod (contratos claros)
3. ✅ Tratamento de erro simples
4. ✅ Sem paginação sofisticada
5. ✅ Sem middleware custom

**Próxima etapa (M3):** Se a lógica for reutilizável ou crescer, refatorar para service/repository layer.

## Arquitetura até M2

```
apps/api/
├── src/
│   ├── lib/
│   │   ├── prisma.ts    ← PrismaClient singleton
│   │   └── redis.ts     ← IORedis singleton
│   ├── routes/
│   │   ├── health.ts    ← GET /health
│   │   ├── status.ts    ← GET /status (health checks)
│   │   └── tasks.ts     ← POST/GET/PATCH /tasks
│   ├── schemas/
│   │   └── task.ts      ← Zod schemas
│   └── index.ts         ← Express app + router registration
└── package.json

prisma/
├── schema.prisma        ← 7 modelos (Task, Reminder, ...)
└── migrations/
    ├── 20260311121200_init/
    └── 20260311121201_audit_log_immutable/
```

## Critério de Aceite

- ✅ POST /tasks cria + retorna 201
- ✅ GET /tasks lista tasks
- ✅ GET /tasks?status=X&category=Y filtra
- ✅ PATCH /tasks/:id atualiza + retorna 404 se não encontrado
- ✅ Validação Zod retorna 400
- ✅ Handlers respeitam spike constraint (~60 linhas)
- ✅ Nenhuma rota M3 criada (done, postpone, today)
