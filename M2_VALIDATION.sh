#!/bin/bash

# M2 Spike Validation — Task CRUD endpoints
# Run after: pnpm install && docker compose up -d && pnpm --filter api prisma migrate dev

echo "🚀 M2 Validation — Task CRUD"
echo "================================"
echo ""

# 1. Create task
echo "1️⃣  POST /tasks — Create task"
TASK_ID=$(curl -s -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Pagar fatura","category":"casa","priority":"HIGH","due_at":"2026-04-01T00:00:00Z"}' | jq -r '.id')
echo "Created task: $TASK_ID"
echo ""

# 2. List all tasks
echo "2️⃣  GET /tasks — List all tasks"
curl -s http://localhost:3000/tasks | jq '.[] | {id, title, category, priority, status}'
echo ""

# 3. Filter by status and category
echo "3️⃣  GET /tasks?status=PENDING&category=casa — Filter tasks"
curl -s "http://localhost:3000/tasks?status=PENDING&category=casa" | jq '.[] | {id, title, category, status}'
echo ""

# 4. Update task status
echo "4️⃣  PATCH /tasks/:id — Update task status"
curl -s -X PATCH http://localhost:3000/tasks/$TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}' | jq '{id, title, status, updated_at}'
echo ""

# 5. Validation error
echo "5️⃣  Error handling — Invalid category"
curl -s -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","category":"invalida"}' | jq '.error'
echo ""

echo "✅ M2 Validation complete!"
