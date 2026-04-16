# Elvis — Instruções para Agentes de IA

Este arquivo fornece contexto obrigatório para agentes de IA externos (Jules, Codex, etc.)
que trabalham neste repositório. Leia antes de qualquer mudança.

## Visão Geral do Projeto

Elvis é um assistente pessoal baseado em WhatsApp com backend Node.js/Express/Prisma.

**Estrutura (monorepo pnpm):**
- `apps/api` — API Express principal (rotas, webhook, comandos)
- `packages/shared` — tipos e serviços compartilhados (oauthService, prisma client)
- `docs/architecture.md` — documento de referência obrigatório

## Antes de qualquer mudança

```bash
git fetch origin && git checkout main && git pull
```

Sempre partir do HEAD atual de `main`. Nunca trabalhar sobre um snapshot desatualizado.

## As 4 Invariantes de Ouro (nunca violar)

1. **Human-in-the-Loop** — nenhuma escrita externa (e-mail, calendário, WhatsApp) sem
   `approval_record_id` confirmado no banco. O usuário sempre aprova antes da ação.

2. **Audit-Log Imutável** — proibido UPDATE ou DELETE em `audit_log`. Apenas INSERT.
   Rastreabilidade completa e imutável é um requisito.

3. **Isolamento de Credenciais** — descriptografia AES-GCM exclusivamente em
   `packages/shared/src/services/oauthService.ts`. Nenhum outro arquivo descriptografa tokens.

4. **Contrato Ternário WhatsApp** — respostas ao usuário via WhatsApp obrigatoriamente com
   3 componentes: (1) o que foi entendido, (2) o que foi feito, (3) próximo passo.

## Workflow obrigatório para correção de violações

1. Ler a issue na íntegra — identificar qual invariante foi violada e em qual arquivo
2. Ler `docs/architecture.md` — especialmente a seção "Definition of Done"
3. Ler os arquivos apontados na análise do Sentinel
4. Implementar a **correção mínima** — não refatorar código não relacionado à violação
5. Rodar os testes: `pnpm --filter api exec vitest run`
6. Criar PR com `Closes #N` no corpo — o board PDLC move o card automaticamente

## O que NÃO fazer

- Não criar intents ou handlers paralelos ao que já existe
  (ex: não criar `APPROVE` se já existe `CONFIRM`/`CANCEL` com a mesma responsabilidade)
- Não usar `cors()` com wildcard `*` — padrão do projeto é `origin: process.env.CORS_ORIGIN ?? false`
- Não commitar direto em `main`
- Não abrir PR sem os testes passando
- Não reescrever arquivos inteiros — mudanças cirúrgicas e focadas
- Não propor correções para violações que já foram resolvidas em commits posteriores

## Padrões do projeto

- **Testes:** Vitest — `pnpm --filter api exec vitest run`
- **Lint/types:** `pnpm --filter api exec tsc --noEmit`
- **Approval gate:** fluxo `AWAITING_APPROVAL` → `CONFIRM`/`CANCEL` via Redis + tabela `Communication`
- **Pending state:** `packages/shared/src/services/pendingStateService.ts`
- **OAuth tokens:** `packages/shared/src/services/oauthService.ts` (único ponto de descriptografia)
