# Estrutura do Projeto

```
monorepo/
│
├── 📄 package.json                    ✓ Root workspace com pnpm
├── 📄 pnpm-workspace.yaml             ✓ Configuração de workspaces
├── 📄 tsconfig.base.json              ✓ TypeScript base config com paths
├── 📄 eslint.config.mjs               ✓ ESLint flat config
├── 📄 .prettierrc                     ✓ Prettier config
├── 📄 docker-compose.yml              ✓ 4 serviços (API, Worker, Postgres, Redis)
├── 📄 .env.example                    ✓ Variáveis de ambiente (sem segredos)
├── 📄 .gitignore                      ✓ Git ignore rules
├── 📄 README.md                       ✓ Documentação
│
├── 📁 apps/
│   │
│   ├── 📁 api/                        ✓ Express Server
│   │   ├── package.json              ✓ express, ts-node, @types/express
│   │   ├── tsconfig.json             ✓ Estende tsconfig.base.json
│   │   ├── Dockerfile                ✓ Build multi-stage
│   │   └── src/
│   │       └── index.ts              ✓ Express app porta 3000
│   │
│   └── 📁 worker/                     ✓ Worker com IORedis
│       ├── package.json              ✓ ioredis, ts-node
│       ├── tsconfig.json             ✓ Estende tsconfig.base.json
│       ├── Dockerfile                ✓ Build multi-stage
│       └── src/
│           └── index.ts              ✓ Redis connection com retry
│
├── 📁 packages/
│   │
│   └── 📁 shared/                     ✓ Tipos compartilhados
│       ├── package.json              ✓ @shared/types
│       ├── tsconfig.json             ✓ Estende tsconfig.base.json
│       └── src/
│           └── index.ts              ✓ Tipos base (vazio)
│
└── 📁 infra/                          ✓ Reservado para IaC (vazio)
    └── .gitkeep
```

## Checklist de Validação ✓

| Item | Status |
|------|--------|
| Estrutura de diretórios | ✓ Completa |
| Root package.json | ✓ JSON válido |
| pnpm-workspace.yaml | ✓ YAML válido |
| tsconfig.base.json | ✓ JSON válido |
| apps/api/package.json | ✓ JSON válido |
| apps/api/tsconfig.json | ✓ JSON válido |
| apps/api/src/index.ts | ✓ Express pronto |
| apps/api/Dockerfile | ✓ Válido |
| apps/worker/package.json | ✓ JSON válido |
| apps/worker/tsconfig.json | ✓ JSON válido |
| apps/worker/src/index.ts | ✓ IORedis pronto |
| apps/worker/Dockerfile | ✓ Válido |
| packages/shared/package.json | ✓ JSON válido |
| packages/shared/tsconfig.json | ✓ JSON válido |
| packages/shared/src/index.ts | ✓ Tipos base |
| docker-compose.yml | ✓ YAML válido (4 serviços) |
| .env.example | ✓ Sem segredos reais |
| .gitignore | ✓ Pronto |
| README.md | ✓ Documentado |
| eslint.config.mjs | ✓ Flat config |
| .prettierrc | ✓ Formatação |

## Portas de Serviços

| Serviço | Porta Host | Porta Container |
|---------|-----------|-----------------|
| api | 3000 | 3000 |
| postgres | 5433 | 5432 |
| redis | 6380 | 6379 |
| worker | - | interno |

## Variáveis de Ambiente

Definidas em `.env.example`:
- `NODE_ENV=development`
- `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/monorepo`
- `REDIS_URL=redis://:@redis:6379`

## Próximos Passos

```bash
# 1. Instalar dependências
pnpm install

# 2. Subir serviços
docker compose up -d

# 3. Validar serviços
docker compose ps

# 4. Build TypeScript
pnpm build

# 5. Modo desenvolvimento
pnpm dev
```
