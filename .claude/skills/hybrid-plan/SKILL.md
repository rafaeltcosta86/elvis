---
name: hybrid-plan
description: Planeja o trabalho em blocos [TRAD] vs [COWORK] a partir do task.md e gera Cowork Briefs com critérios de aceite e stop condition.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob
---

# Objetivo
Você é meu Tech Lead no Claude Code. Gere um plano de trabalho híbrido:
- **[TRAD]** (fora do Cowork): decisões, trade-offs, debugging investigativo, validação de arquitetura/modelagem/permissões, tarefas ambíguas.
- **[COWORK]** (com Cowork): execução mecânica/multi-arquivo, scaffolding/config, refactors repetitivos e tarefas bem delimitadas com aceite objetivo.

> IMPORTANTE: Claude Code NÃO executa Cowork automaticamente. Para blocos [COWORK], você deve produzir um **COWORK BRIEF** pronto para eu copiar/colar no Cowork, e deixar claro “🚦Próximo bloco = [COWORK]”.

# Entradas
- Arquivo de progresso padrão: `task.md` na raiz.
- Specs (quando existirem): `PRD.md` e `implementation_plan.md` na raiz (ou em `docs/`).

## Argumentos (opcionais)
Se eu passar argumentos, interprete assim:
- `$ARGUMENTS[0]` (opcional): caminho do arquivo de tarefas (ex.: `docs/task.md`). Se omitido, use `task.md`.
- `$ARGUMENTS[1]` (opcional): modo de leitura das specs:
  - `lite` (padrão): ler apenas trechos essenciais (sumário, objetivos, escopo, milestones).
  - `full`: ler specs com mais profundidade para checar dependências, riscos e ordem de execução.

Se nada for passado, assuma:
- task file = `task.md`
- modo = `lite`

# Regra de vibe coding (obrigatória)
- Regra de ouro: **sempre entregue algo testável em 30–60 linhas antes de generalizar**.
- “Testável” = comandos claros (ex.: `pnpm lint`, `pnpm test`, `pnpm build`, abrir rota X) + resultado esperado.
- Só depois refatore/extraia camadas.

# Heurística objetiva para escolher [TRAD] vs [COWORK]
Use **[TRAD]** quando:
- houver ambiguidade, decisão de arquitetura/stack/naming/contratos;
- for debugging exploratório (build quebrando, erro intermitente, comportamento difícil);
- envolver segurança/auth/RLS/permissões;
- faltar critério de aceite verificável.

Use **[COWORK]** quando:
- houver critério de aceite verificável e stop condition clara;
- envolver mudanças em 3+ arquivos, scaffolding/config, repetição de padrão;
- der para limitar o escopo por pastas/arquivos;
- risco baixo e rollback simples (reverter commit).

Use [COWORK] quando:
- critério de aceite verificável + stop condition
- mudanças em 3+ arquivos, scaffolding
- risco baixo e rollback simples
- A tarefa será reutilizada 2+ vezes OU o overhead do brief < economia de tokens do dev (regra: se brief < 300 tokens e vai rodar 2+ vezes, use Cowork)
- **[NOVO] Há acoplamento entre arquivos ou padrões que cascateiam (schema → migration → rotas)**

# Política de economia de créditos (obrigatória)
- Nunca proponha um bloco [COWORK] “grande”. Prefira 1–3 tarefas pequenas por bloco.
- Todo bloco [COWORK] precisa ter:
  - **Escopo permitido** (pastas/arquivos)
  - **O que NÃO fazer** (proibido refactor amplo, mudar stack, renomear diretórios)
  - **Critério de aceite** (comandos exatos)
  - **Stop condition** (“pare imediatamente quando passar”)

# Formato obrigatório da sua resposta
Sempre produza exatamente as seções abaixo.

## A) Status atual (do task file)
- Concluído (top 3):
- Em andamento:
- Bloqueadores:
- Próximos 3 itens:
- Nota rápida (1 frase) sobre risco/ordem das coisas

## B) Work Blocks (2 a 5 blocos no máximo, em ordem)
Para cada bloco:

1) ✅ [TRAD] ou ✅ [COWORK] — <nome curto do bloco>
   - Por que esse modo (1 frase):
   - Objetivo (1–2 frases):
   - Entradas/decisões necessárias (se [TRAD]):
   - Escopo permitido (se [COWORK]): (ex.: `apps/web/**`, `packages/shared/**`)
   - Passos (bullets curtos):
   - Critério de aceite (comandos + resultado esperado):
   - Stop condition:
   - Risco/rollback (1–2 bullets):
   - task.md: quais checkboxes/linhas devem ser atualizadas ao final:

### Se o bloco for [COWORK], inclua obrigatoriamente um COWORK BRIEF copiável:
--- COWORK BRIEF (copiar/colar no Cowork) ---
Tarefa (1 frase):
Contexto mínimo (3 bullets):
Arquivos/pastas permitidos:
O que NÃO fazer:
Passos (curto):
Critério de aceite (comandos exatos):
Stop condition:
Checklist final (3–6 itens):
--- FIM ---

## C) Próxima ação imediata
- Escreva explicitamente:
  - “🚦Próximo bloco = [TRAD]” OU “🚦Próximo bloco = [COWORK]”
- Justifique em 1 frase.
- Se for [COWORK], diga: “Copie o COWORK BRIEF acima e rode no Cowork.”

# Procedimento
1) Localize e leia o arquivo de tarefas:
   - Se `$ARGUMENTS[0]` foi passado, use esse caminho.
   - Caso contrário, tente `task.md`. Se não existir, procure por `**/task.md` e use o mais provável (preferir raiz).

2) Detecte automaticamente specs do projeto:
   - Use Glob para procurar:
     - `PRD.md` OU `**/PRD.md`
     - `implementation_plan.md` OU `**/implementation_plan.md`
   - Se encontrados:
     - No modo `lite`: leia apenas as seções iniciais + headings e milestones/aceites.
     - No modo `full`: leia com mais profundidade para validar dependências e ordem.
   - Se NÃO encontrados: prossiga só com `task.md` e proponha um bloco [TRAD] curto “criar PRD/plan” (sem executar).

3) Extraia do `task.md`: concluídos, pendentes, bloqueadores e o “next most valuable step”.

4) Monte 2–5 Work Blocks (no máximo), cada um marcado como [TRAD] ou [COWORK], garantindo:
   - o primeiro bloco é pequeno e testável
   - o plano respeita o PRD/Implementation Plan (quando existirem)
   - se houver inconsistência entre `task.md` e `implementation_plan.md`, proponha um bloco [TRAD] “alinhar docs” (não corrija automaticamente)

5) Para cada bloco [COWORK], gere um COWORK BRIEF copiável com:
   - escopo permitido
   - o que NÃO fazer
   - critério de aceite com comandos exatos
   - stop condition (“pare imediatamente ao passar”)

# Observações finais
- Não assuma que posso rodar tudo agora: sempre inclua comandos de teste e resultados esperados.
- Se algo estiver inconsistente no task.md, proponha a correção como um bloco [TRAD] curto (não corrija automaticamente).
- **Decisões com custo:** sempre que uma opção envolver custo financeiro (API paga, serviço externo, consumo de tokens, infra adicional) ou custo de complexidade/manutenção significativamente maior, sinalize explicitamente com `💰 tem custo:` antes de descrever a opção. Exemplo: `💰 tem custo: chamar LLM por mensagem (~$0.002/req) vs regex gratuito`. O usuário deve tomar a decisão com clareza sobre o trade-off.