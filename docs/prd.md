# Elvis Assistant — PRD (Produto)

## 1) Visão
Construir um assistente pessoal proativo estilo “Jarvis” que reduz esquecimentos de tarefas, eventos e pendências de comunicação. O assistente opera principalmente via **WhatsApp** e é capaz de capturar tarefas rapidamente, planejar o dia, resumir e-mails, criar reuniões no calendário e lembrar de eventos — com foco em **proatividade** e **aprendizado contínuo**.

## 2) Contexto e problema
- Eu esqueço pequenas tarefas do dia mesmo quando anoto; tarefas se perdem no meio de outras anotações.
- Ferramentas como Notion/Notas/OneNote não encaixaram no meu hábito.
- Tenho dificuldade com e-mails: deixo de ler mensagens importantes e atraso respostas.

## 3) Objetivos
### 3.1 Objetivo principal (Sucesso padrão)
Evitar esquecimentos de:
- tarefas (captura e execução),
- eventos (preparação e lembretes),
- comunicação (responder e organizar e-mails e mensagens).

### 3.2 Objetivo “Wow” (Jarvis)
Ser **ativo/proativo** e **aprender continuamente** sem eu precisar “configurar tudo” ou ensinar toda hora:
- Manter um **User Model** (preferências, rotinas, prioridades, pessoas importantes).
- Inferir melhorias pela minha interação (concluir/adiar/ignorar; horários; categorias).
- Ajustar recomendações automaticamente e com explicação (“por que sugeriu isso?”).
- 1x/semana: “O que aprendi sobre você / o que vou mudar” com correções rápidas.

## 4) Público-alvo e escopo inicial
- Usuário único (single-tenant).
- Idioma pt-BR.
- Timezone America/Sao_Paulo.

## 5) Canais e integrações (requisitos fixos)
### 5.1 Canal principal
- **WhatsApp obrigatório** (não usar Telegram).

### 5.2 Calendário
- **Somente Outlook Calendar** (Microsoft 365) via Microsoft Graph.

### 5.3 E-mail
- Profissional: **Outlook (Microsoft 365 Mail)** via Microsoft Graph.
- Pessoal: **Gmail** via Gmail API.

### 5.4 Gateway/Orquestração
- **NanoClaw** como gateway do canal e orquestrador de “skills”.

### 5.5 Hospedagem
- Hostinger VPS.

## 6) Escopo do MVP (funcionalidades)
### A) Inbox de tarefas (captura)
O usuário envia mensagens tipo:
- “Lembrar de pagar a fatura amanhã”
- “Quando tiver tempo: marcar dentista”
- “Pedir pro João o documento X”

O assistente deve:
- Criar tarefa com: título, descrição, categoria (casa/trabalho/pessoas/investimentos etc.), prioridade, tags, status, created_at, due_at (se houver), reminders, origem (canal).
- Se faltar dado crítico (ex.: data/horário), perguntar **uma vez** e sugerir defaults (“sem data → backlog”).
- Confirmar em 1 mensagem curta o que capturou.

### B) Gestão do dia
Comandos e intenções:
- “Planejar meu dia” e/ou `/hoje`: 
  - mostrar eventos do Outlook do dia,
  - listar tarefas vencidas/urgentes,
  - sugerir 3–7 prioridades.
- “Hoje vou fazer: …”: criar/atualizar lista “Hoje”.
- “O que falta hoje?”: mostrar status do dia.
- “Concluir X” ou `/done X`
- “Adiar X para amanhã/semana que vem” ou `/adiar X`

Rotinas automáticas (anti-spam):
- Briefing manhã (default 07:30).
- Check-in meio do dia (default 13:30, só se houver pendência relevante).
- Review fim do dia (default 20:00).

### C) E-mail (resumo e resposta assistida)
- `/email`: resumo diário de e-mails “importantes” (Outlook + Gmail), com explicação de critérios.
- Sugestão de respostas em forma de rascunho.
- Envio somente com aprovação explícita (CONFIRMAR/CANCELAR).
- Modo dry-run para teste (não enviar nada).

### D) Calendário (Outlook)
- `/semana`: resumo da semana atual + próxima.
- Lembretes configuráveis (default: 1 dia + 2 horas antes).
- Criar reunião por comando:
  - “marcar reunião com X amanhã às 15h por 30 min assunto Y”
  - sempre com prévia e aprovação.
- Detectar conflitos e sugerir alternativas.

### E) Mensagens para pessoas (WhatsApp)
- MVP: gerar mensagem e pedir confirmação.
- Se envio automático para terceiros não for viável, fallback: mensagem pronta para copiar/colar e registrar no audit log.

### F) Auditoria e segurança (MVP)
- Audit log imutável para:
  - envios, criação/alteração de eventos, mensagens para terceiros,
  - decisões automáticas relevantes (ex.: “classificado como importante”).
- Approval gates padrão para ações de risco.

## 7) UX no WhatsApp (contrato de resposta)
Toda resposta do assistente deve conter, curto:
1) O que entendeu
2) O que fez
3) Próximo passo sugerido

Ações de risco:
- mostrar prévia + pedir “CONFIRMAR” ou “CANCELAR”.

## 8) Requisitos não-funcionais
- Confiabilidade: lembretes não podem “sumir”.
- Observabilidade: logs estruturados + correlation id por conversa.
- Privacidade e segurança: tokens OAuth criptografados em repouso; secrets via env.
- Anti-spam: quiet hours, limite diário, backoff.
- Explicabilidade: permitir “por que você sugeriu isso?”.

## 9) Fora de escopo (por enquanto)
- Multi-usuário.
- Assistente por voz fora do WhatsApp.
- Integração com Google Calendar.
- Envio automático sem aprovação por padrão (só futuro com whitelist/regras).

## 10) Métricas de sucesso (sugestão)
- % de tarefas capturadas que foram concluídas ou reagendadas (não “esquecidas”).
- Taxa de “tarefas vencidas sem ação” por semana.
- Tempo médio de resposta a e-mails importantes (com assistente).
- Nº de lembretes úteis vs. ignorados (para calibrar proatividade).
- Satisfação subjetiva semanal (1–5): “Esqueci menos coisas?”

## 11) Riscos e mitigação
- Risco: spam de lembretes → Mitigação: limites, quiet hours, backoff.
- Risco: integrar envio automático → Mitigação: approval gates + dry-run + whitelist.
- Risco: dados sensíveis em logs → Mitigação: log redaction + audit focado em metadados.
- Risco: drift do “aprendizado” → Mitigação: relatório semanal + botões de correção.

## 12) Perguntas em aberto
- Política de categorias padrão e como o usuário corrige rapidamente.
- Quais horários padrões para briefing/check-in/review.
- Como definir “importância” dos e-mails (regras + aprendizado).