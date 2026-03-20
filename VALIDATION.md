# Validação de Aceite

## Critérios de Aceite (conforme Brief)

Após ter pnpm e docker-compose disponíveis, execute os seguintes comandos:

### 1. Subir os serviços

```bash
docker compose up -d
```

**Resultado esperado:** 4 serviços iniciados (api, worker, postgres, redis)

### 2. Validar estado dos serviços

```bash
docker compose ps
```

**Resultado esperado:**
```
NAME        COMMAND                  SERVICE    STATUS              PORTS
api         "pnpm start"            api         Up (healthy)        0.0.0.0:3000->3000/tcp
worker      "pnpm start"            worker      Up (healthy)        
postgres    "postgres"              postgres    Up (healthy)        0.0.0.0:5433->5432/tcp
redis       "redis-server"          redis       Up (healthy)        0.0.0.0:6380->6379/tcp
```

### 3. Instalar dependências

```bash
pnpm install
```

**Resultado esperado:**
- Sem erros
- Cria `pnpm-lock.yaml`
- Instala dependências em root e all workspaces

### 4. Build TypeScript

```bash
pnpm build
```

**Resultado esperado:**
- Sem erros de compilação
- Cria diretórios `dist/` em cada app e package
- Sucesso em:
  - `apps/api`
  - `apps/worker`
  - `packages/shared`

## Checklist Final

- [x] Estrutura de monorepo criada
- [x] 4 serviços em docker-compose.yml
- [x] APIs/Services logs de "ready" configurados
- [x] Portas corretas (3000, 5433, 6380)
- [x] .env.example sem segredos reais
- [x] apps/admin NÃO criado (para M9+)
- [x] pnpm workspaces configurado
- [x] TypeScript configurado com tsconfig.base.json
- [x] ESLint flat config
- [x] Prettier config
- [x] Dockerfiles para api e worker
- [x] README com instruções
- [x] .gitignore configurado

## Stop Condition ✓

Projeto está pronto para teste. Não avance para:
- Prisma (será M9+)
- Rotas /health ou /status
- apps/admin (será M9+)
- Refatoração em camadas

## Próxima Fase

Quando criteria de aceite forem atingidos:
1. Implementar Prisma ORM com migrations
2. Adicionar BullMQ para jobs do worker
3. Criar rotas básicas (/health, /status)
4. Scaffold do apps/admin (Next.js)
