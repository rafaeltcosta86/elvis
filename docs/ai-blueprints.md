# 📄 Elvis: AI Operational Blueprints & Governance

Este documento define as regras de engajamento, padrões de arquitetura e restrições de segurança para agentes de IA que operam neste repositório.

---

## 🛡️ 1. Invariantes de Ouro (Sentinel Rules)
Estas regras são auditadas automaticamente pelo **Gemini Sentinel** em cada PR. Violações bloqueiam o merge imediatamente.

* **Human-in-the-Loop (Escrita Segura):** Nenhuma operação de escrita externa (envio de e-mail, criação de eventos no calendário ou mensagens para terceiros) pode ser executada sem validar a presença de um `approval_record_id` confirmado no banco de dados.
* **Audit-Log Imutável:** É proibido qualquer comando de `UPDATE` ou `DELETE` na tabela `audit_log`. A auditoria deve ser estritamente *append-only*.
* **Isolamento de Credenciais:** Descriptografia de tokens (AES-GCM) deve ocorrer exclusivamente dentro do `packages/shared/src/services/oauthService.ts`. O uso direto da `OAUTH_ENC_KEY` em serviços de domínio é proibido.
* **Contrato de Resposta Ternário:** Toda interação proativa ou resposta de comando no WhatsApp deve seguir a estrutura: 1. O que foi entendido; 2. O que foi feito; 3. O próximo passo sugerido.

---

## 🛠️ 2. Ecossistema e Toolchain
* **Runtime & Package Manager:** Node 22 LTS utilizando `pnpm workspaces`.
* **Base de Dados:** PostgreSQL 16 com Prisma ORM.
* **TDD Guard:** Vitest 2.x é o motor de testes obrigatório. O ciclo **Red-Green-Refactor** deve ser respeitado, com execução via `pnpm test`.
* **CI/CD:** GitHub Actions localizado em `.github/workflows/sentinel.yml`, integrando Auditoria de Arquitetura via Gemini e validação de testes.

---

## 🔁 3. Modelo de Execução Híbrida
As tarefas devem ser categorizadas antes da execução para definir o nível de autonomia da IA.

| Modo | Aplicação | Restrição |
| :--- | :--- | :--- |
| **[TRAD]** | Mudanças de Schema, Fluxos OAuth, Segurança e Deploy. | Requer plano detalhado e aprovação humana antes de qualquer commit. |
| **[COWORK]** | CRUDs, Refatoração, Novos Testes e UI mecânica. | Autonomia para múltiplos arquivos, parando apenas em caso de ambiguidade. |

---

## 📜 4. Regras Operacionais para Agentes
1.  **Tag `[skip audit]`:** Utilize obrigatoriamente esta tag em mensagens de commit puramente documentais (ex: atualizar `task.md` ou `docs/architecture.md`) para economizar tokens e tempo de CI.
2.  **Retroalimentação de Backlog:** Falhas de auditoria ou débitos técnicos detectados devem ser convertidos em Issues e registrados na seção correspondente do `task.md`.
3.  **Resolução de Conflitos:** Devido a restrições de rede, resolva conflitos via comparação direta de arquivos e novos commits de mesclagem, evitando comandos complexos de `rebase`.
4.  **Dry-Run por Padrão:** Em ambientes de desenvolvimento ou correção automática, o Jules deve preferir o modo `dry_run: true` em integrações externas até que a lógica de aprovação seja validada.

---

## 🎯 5. Priorização de Fluxo
* **TDD First:** Nenhuma implementação é considerada concluída sem testes unitários ou de integração correspondentes.
* **Explicações de Proatividade:** Toda recomendação de "aprendizado" (User Model) deve incluir o campo `reasoning` explicando a origem da sugestão.