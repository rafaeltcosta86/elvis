# Monorepo - pnpm + Docker Compose

Scaffolding de monorepo com pnpm workspaces, Node 22 LTS, TypeScript, e Docker Compose com 4 serviços.

## Estrutura

```
.
├── apps/
│   ├── api/           # Express API (porta 3000)
│   └── worker/        # BullMQ Worker (conecta Redis)
├── packages/
│   └── shared/        # Tipos compartilhados (@shared/types)
├── infra/             # (vazio, reservado para IaC)
├── docker-compose.yml # Orquestração de serviços
├── package.json       # Root workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs
└── .prettierrc
```

## Serviços

- **api** - Express server na porta 3000
- **worker** - Worker que conecta ao Redis (porta 6379 interno)
- **postgres** - PostgreSQL 16 Alpine (porta 5433:5432)
- **redis** - Redis 7 Alpine (porta 6380:6379)

## Portas

- API: `3000`
- PostgreSQL: `5433` (host) → `5432` (container)
- Redis: `6380` (host) → `6379` (container)

## Variáveis de Ambiente

Veja `.env.example` para as variáveis necessárias:
- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`

## Como Usar

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Subir Docker Compose

```bash
docker compose up -d
```

### 3. Validar serviços

```bash
docker compose ps
```

Todos os 4 serviços devem estar em estado **running** ou **healthy**.

### 4. Build do TypeScript

```bash
pnpm build
```

### 5. Modo desenvolvimento

```bash
pnpm dev
```

Executa `dev` em paralelo em todos os workspaces.

## Lint e Format

```bash
pnpm lint
pnpm format
```

## Checklist de Aceite

- [ ] `docker compose ps` → 4 serviços running/healthy
- [ ] `pnpm install` → sem erros
- [ ] `pnpm build` → sem erros de compilação TS
- [ ] `.env.example` existe (sem valores reais)
- [ ] `apps/admin` NÃO criado
- [ ] Nenhum `.env` com segredos reais commitado

## Próximos Passos (M9+)

- [ ] Prisma ORM + migrations
- [ ] Rotas básicas (/health, /status)
- [ ] Integração BullMQ para worker
- [ ] `apps/admin` (Next.js)
