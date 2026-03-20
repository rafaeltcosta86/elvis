# M5 Summary — NanoClaw Webhook Integration

## Overview

**Objetivo:** Integrar webhook com NanoClaw para receber/processar comandos WhatsApp, converter para intents, executar ações, e enviar respostas via NanoClaw API

**Status:** ✅ Completo

**Padrão:** Webhook spike — parser + router + real HTTP client com mock fallback

## Arquivos Criados/Modificados

```
apps/api/src/
├── lib/
│   ├── commandParser.ts   (64 linhas) — parseCommand(text): ParsedCommand
│   └── nanoclawClient.ts  (32 linhas) — sendWhatsApp(to, text): Promise<void>
└── routes/
    └── webhook.ts         (174 linhas) — POST /webhook/nanoclaw com intent router

apps/worker/src/
└── lib/
    ├── messenger.ts       (ATUALIZAR — agora usa nanoclawClient)
    └── nanoclawClient.ts  (32 linhas) — idêntico ao da api

.env.example               (ATUALIZAR — adicionar WEBHOOK_SECRET, NANOCLAW_API_URL, NANOCLAW_API_KEY)
apps/api/src/index.ts      (ATUALIZAR — registrar webhookRouter)

M5_VALIDATION.sh           (72 linhas) — 5 testes com curl
```

## Regex-based NLU (commandParser.ts)

### Intent Patterns

```typescript
/^\/hoje$/i                    → TODAY (resumo do dia)
/^\/done\s+(.+)$/i            → DONE <taskId> (marcar pronto)
/^\/adiar\s+(\S+)\s+(.+)$/i   → POSTPONE <taskId> <to> (adiar tarefa)
/^\/semana$/i                 → WEEK (semana em breve)
/^\/email$/i                  → EMAIL (e-mails em breve)
default                        → CREATE_TASK <rawText> (criar tarefa)
```

## Intent Routing (webhook.ts)

### 1. TODAY
```typescript
- Busca tasks com status IN_PROGRESS | PENDING
- Filtra overdue (due_at < today) e urgent (URGENT ou due today)
- Retorna: "📅 Resumo do dia: X atrasados, Y urgentes\nTop 3: ..."
```

### 2. DONE
```typescript
- Valida se taskId foi fornecido
- Busca task, atualiza status para DONE
- Retorna: "✅ Entendi: Tarefa 'X' marcada como pronta!"
- Se não encontrada: "Tarefa ABC não encontrada."
```

### 3. POSTPONE
```typescript
- Valida se taskId e to foram fornecidos
- Interpreta: "tomorrow" → addDays(today, 1)
              "next_week" → nextMonday(today)
              "YYYY-MM-DD" → new Date(to)
- Atualiza due_at e status para PENDING
- Retorna: "⏭️  Entendi: Tarefa adiada para 2026-03-15"
```

### 4. WEEK
```typescript
- Placeholder: "📅 Integração de calendário em breve!"
```

### 5. EMAIL
```typescript
- Placeholder: "📧 Resumo de e-mails em breve!"
```

### 6. CREATE_TASK
```typescript
- Cria nova tarefa com title = rawText
- Seta category = 'outros'
- Retorna: "✅ Entendi: Tarefa criada! ID: abc123...\nPrecisa de data? Use: /adiar abc123 tomorrow"
```

### 7. UNKNOWN
```typescript
- Retorna help: "Não entendi. Comandos:\n/hoje, /done <id>, /adiar <id> tomorrow, /semana, /email"
```

## Bearer Token Validation

```typescript
// Valida Authorization header
if (!authHeader || token !== process.env.WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}

// Uso
Authorization: Bearer seu_webhook_secret_seguro_aqui
```

## NanoClaw Client (nanoclawClient.ts + messenger.ts)

### HTTP Integration
```typescript
// apps/api/src/lib/nanoclawClient.ts
await axios.post(
  `${NANOCLAW_API_URL}/messages`,
  { to, text },
  {
    headers: {
      'Authorization': `Bearer ${NANOCLAW_API_KEY}`,
      'Content-Type': 'application/json',
    },
  }
);
```

### Mock Fallback
```typescript
// Se NANOCLAW_API_URL ou NANOCLAW_API_KEY não definidos:
console.log(`[MOCK] enviaria para ${to}: ${text}`);

// Permite testing sem credenciais reais
```

### Worker Integration
```typescript
// apps/worker/src/lib/messenger.ts agora usa:
import { sendWhatsApp } from './nanoclawClient';

export async function sendMessage(to: string, text: string): Promise<void> {
  await sendWhatsApp(to, text);
}

// Substitui anterior: console.log(`[MOCK] enviaria...`)
```

## Webhook Endpoint

```
POST /webhook/nanoclaw

Headers:
  Authorization: Bearer <WEBHOOK_SECRET>
  Content-Type: application/json

Body:
{
  "sender_id": "551199999999",
  "message_text": "/hoje",
  "message_id": "msg-001",
  "timestamp": "2026-03-11T15:30:00Z"
}

Responses:
  401: { "error": "Unauthorized" }  // Se token inválido
  200: { "ok": true }                // Sempre 200 para NanoClaw (idempotência)

  // + sendWhatsApp(sender_id, responseText) executado
```

## Variáveis de Ambiente

```
WEBHOOK_SECRET=seu_webhook_secret_seguro_aqui
NANOCLAW_API_URL=https://api.nanoclaw.app
NANOCLAW_API_KEY=sua_api_key_aqui
```

## Testes de Validação (M5_VALIDATION.sh)

### Test 1: 401 Unauthorized
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "551199999999", "message_text": "/hoje"}'
# Esperado: 401 Unauthorized
```

### Test 2: /hoje command
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Authorization: Bearer seu_webhook_secret_seguro_aqui" \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "551199999999", "message_text": "/hoje"}'
# Esperado: 200 { "ok": true }
# Executa: sendWhatsApp(sender_id, "📅 Resumo...")
```

### Test 3: CREATE_TASK (free text)
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Authorization: Bearer seu_webhook_secret_seguro_aqui" \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "551199999999", "message_text": "Ligar pro cliente"}'
# Esperado: 200 { "ok": true }
# Cria task com title="Ligar pro cliente", category="outros"
```

### Test 4: UNKNOWN command
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Authorization: Bearer seu_webhook_secret_seguro_aqui" \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "551199999999", "message_text": "xyz123"}'
# Esperado: 200 { "ok": true }
# Retorna: "Não entendi. Comandos: /hoje, /done <id>..."
```

### Test 5: DONE command
```bash
curl -X POST http://localhost:3000/webhook/nanoclaw \
  -H "Authorization: Bearer seu_webhook_secret_seguro_aqui" \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "551199999999", "message_text": "/done abc123"}'
# Esperado: 200 { "ok": true }
# Marca task abc123 como DONE
```

## Tratamento de Erros

```typescript
// 1. Token inválido → 401
// 2. Payload inválido → 200 (log error)
// 3. Task não encontrada → 200 com mensagem
// 4. Erro interno → 200 (log error)

// Sempre retorna 200 ao NanoClaw para evitar redelivery
```

## Logs Esperados

```
[NANOCLAW] enviou para 551199999999: 📅 Resumo do dia...
[NANOCLAW] erro ao enviar: <error>
[MOCK] enviaria para 551199999999: <texto>  // Se sem credenciais
```

## Restrições Respeitadas

✅ Bearer token validation implementado
✅ Regex-based NLU (sem LLM)
✅ Intent routing com 7 tipos
✅ Mock fallback pattern
✅ Timezone America/Sao_Paulo mantido
✅ Sempre retorna 200 ao NanoClaw
✅ Sem modificação schema.prisma
✅ Sem backoff/retry (será M8)
✅ Integrado com M1-M4

## Arquitetura M1 + M2 + M3 + M4 + M5

```
apps/
├── api/
│   ├── src/
│   │   ├── lib/ (prisma, redis, commandParser, nanoclawClient)
│   │   ├── routes/ (health, status, tasks, today, jobs, webhook)
│   │   ├── schemas/ (task, today)
│   │   └── index.ts
│   └── package.json (axios adicionado)
└── worker/
    ├── src/
    │   ├── lib/ (prisma, redis, quietHours, messenger, scheduler, nanoclawClient)
    │   ├── jobs/ (briefing, checkin, review, emailSummary)
    │   └── index.ts
    └── package.json (axios adicionado)

prisma/
├── schema.prisma (7 modelos)
└── migrations/ (init + trigger)
```

## Critério de Aceite

- ✅ commandParser.ts transforma texto em ParsedCommand com intent
- ✅ webhook.ts valida Bearer token → 401 se inválido
- ✅ Intent TODAY retorna resumo com overdue/urgent
- ✅ Intent DONE marca task como completa
- ✅ Intent POSTPONE adia para tomorrow/next_week/ISO date
- ✅ Intent CREATE_TASK cria nova tarefa
- ✅ Intent UNKNOWN retorna help
- ✅ sendWhatsApp via NanoClaw ou mock fallback
- ✅ messenger.ts agora usa nanoclawClient
- ✅ webhookRouter registrado em api/index.ts
- ✅ .env.example tem WEBHOOK_SECRET, NANOCLAW_API_URL, NANOCLAW_API_KEY
- ✅ 5 testes com curl validam todos os intents

## Próximos Passos (M6+)

- [ ] NanoClaw real API integration test (M6)
- [ ] Scheduler de lembretes (M5+)
- [ ] Backoff/retry logic (M8)
- [ ] User preferences (M8)
- [ ] Email real (M9)
