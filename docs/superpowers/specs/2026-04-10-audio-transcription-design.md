# M12 — Suporte a Áudio via Groq Whisper

**Data:** 2026-04-10  
**Status:** Aprovado para implementação

---

## 1. Contexto e motivação

O Elvis hoje processa apenas mensagens de texto. O usuário quer enviar comandos por voz (PTT ou arquivo de áudio) e também encaminhar áudios de terceiros para o Elvis interpretar e sugerir ações. A transcrição será feita via Groq Whisper (mesma API já usada para classificação semântica), sem custo adicional no free tier.

---

## 2. Requisitos

| # | Requisito |
|---|---|
| R1 | Detectar `audioMessage` e `pttMessage` em mensagens recebidas pelo Baileys |
| R2 | Baixar e descriptografar o buffer de áudio via Baileys |
| R3 | Transcrever via Groq Whisper (`whisper-large-v3-turbo`) |
| R4 | Áudio do próprio dono (comando): mostrar transcrição + intent detectada + `1️⃣ Confirmar \| 2️⃣ Cancelar` |
| R5 | Áudio encaminhado (contexto): transcrever + sugerir ação via LLM |
| R6 | Encaminhado + LLM retorna UNKNOWN: perguntar "o que devo fazer com isso?" |
| R7 | Transcrição vazia ou falha: retornar mensagem amigável, nunca lançar exceção |
| R8 | Suporte a `audio/ogg`, `audio/ogg; codecs=opus`, `audio/mp4` |
| R9 | Segundo áudio sem confirmar o primeiro: sobrescreve pending (última intenção vence) |

---

## 3. Arquitetura

```
Usuário envia áudio (PTT ou arquivo)
    ↓
apps/baileys/src/index.ts
  • Detecta audioMessage | pttMessage
  • downloadMediaMessage(msg, 'buffer') → Buffer
  • POST /webhook/baileys-audio  (multipart/form-data)
    fields: sender_id, is_forwarded, mimetype
    file:   audio (Buffer)
    ↓
apps/api/src/routes/webhook.ts  — POST /webhook/baileys-audio
  • multer (memStorage, limit 10MB)
  • Valida BAILEYS_WEBHOOK_SECRET
  • Chama whisperService.transcribeAudio(buffer, mimetype)
    ↓
apps/api/src/lib/whisperService.ts
  • POST https://api.groq.com/openai/v1/audio/transcriptions
    model: whisper-large-v3-turbo, language: pt
  • Retorna texto transcrito | '' em caso de erro
    ↓
apps/api/src/routes/webhook.ts — lógica pós-transcrição
  • is_forwarded=false → classifyIntent(texto) → preview + confirm/cancel
  • is_forwarded=true  → llmService.suggestAction(texto) → preview + confirm/cancel
  • Texto vazio         → mensagem de fallback
  • Salva pending no Redis (sobrescreve se já existir)
```

**Princípio:** Baileys é transporte. Toda lógica de negócio fica na API.

---

## 4. Componentes

### 4.1 `apps/baileys/src/index.ts`

**Detecção (após extração de texto existente):**
```typescript
const audioMsg = msg.message.audioMessage ?? msg.message.pttMessage ?? null;
if (audioMsg) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    const mimetype = audioMsg.mimetype ?? 'audio/ogg; codecs=opus';
    const isForwarded = !!(msg.message.audioMessage?.contextInfo?.isForwarded
      ?? msg.message.pttMessage?.contextInfo?.isForwarded);
    // POST multipart para /webhook/baileys-audio
  } catch (err) {
    console.error('[Baileys] Falha ao baixar áudio:', err);
    // não crasha — continua processando próximas mensagens
  }
}
```

**Envio multipart via axios:**
```typescript
const form = new FormData();
form.append('audio', buffer, { filename: 'audio.ogg', contentType: mimetype });
form.append('sender_id', replyTo);
form.append('is_forwarded', String(isForwarded));
form.append('mimetype', mimetype);
await axios.post(`${ELVIS_API_URL}/webhook/baileys-audio`, form, {
  headers: { ...form.getHeaders(), Authorization: `Bearer ${BAILEYS_WEBHOOK_SECRET}` },
  timeout: 30_000,
});
```

**Dependência adicional:** `form-data` (já disponível via axios transitivo).

### 4.2 `apps/api/src/lib/whisperService.ts` (novo)

```typescript
export async function transcribeAudio(
  buffer: Buffer,
  mimetype: string
): Promise<string>
```

- Buffer de 0 bytes → retorna `''` sem chamar Groq
- Timeout de 15s na chamada HTTP
- Qualquer erro → loga + retorna `''`
- Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3-turbo`
- Language: `pt` (forçado — melhora precisão em português)
- Response format: `json`

### 4.3 `apps/api/src/routes/webhook.ts` — novo endpoint

```typescript
router.post('/webhook/baileys-audio', multer().single('audio'), async (req, res) => {
  // 1. Valida token
  // 2. Extrai sender_id, is_forwarded, mimetype
  // 3. transcribeAudio(buffer, mimetype)
  // 4. Texto vazio → resposta de fallback
  // 5. is_forwarded=false → classifyIntent → preview command
  // 6. is_forwarded=true → llmService.suggestAction(texto) → ação sugerida
  // 7. savePending(sender_id, ...) — sobrescreve qualquer pending anterior
  // 8. sendWhatsApp(sender_id, responseText)
});
```

**Formato de resposta — comando próprio:**
```
🎙️ Entendi: "lembra de ligar pra Linic amanhã"

📋 Vou criar a tarefa: ligar pra Linic
Data sugerida: amanhã

1️⃣ Confirmar  |  2️⃣ Cancelar
```

**Formato de resposta — áudio encaminhado:**
```
🎙️ Áudio de terceiro: "preciso que você me mande o relatório até quinta"

💡 Sugestão: criar tarefa "enviar relatório até quinta"

1️⃣ Confirmar  |  2️⃣ Cancelar
```

**Formato de resposta — UNKNOWN encaminhado:**
```
🎙️ Transcrevi: "tá bom então a gente vê isso depois"

Não identifiquei uma ação clara. O que devo fazer com isso?
```

---

## 5. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Transcrição vazia (`""`) | `"🎙️ Não consegui entender o áudio. Tente novamente."` |
| Timeout Groq (>15s) | Mesmo fallback, loga warning |
| Buffer de 0 bytes | Rejeita antes de chamar Groq, mesmo fallback |
| Download falha no Baileys | Loga erro, não envia nada para API, não crasha |
| `audio/mp4` ou outros | Passa mimetype original no multipart — Groq aceita mp3, mp4, ogg, wav, webm |
| Segundo áudio sem confirmar | `savePending` sobrescreve — última intenção vence |
| Encaminhado + UNKNOWN | Pergunta aberta ao usuário |
| Arquivo >10MB | multer rejeita com 413 |
| Token inválido | 401 |
| Campo `audio` ausente no multipart | 400 |

---

## 6. Testes

### `whisperService.test.ts`
- [ ] Buffer válido + mock Groq → retorna texto transcrito
- [ ] GROQ_API_KEY ausente → retorna `''` sem lançar
- [ ] Resposta malformada do Groq → retorna `''`
- [ ] Buffer de 0 bytes → retorna `''` sem chamar Groq
- [ ] Timeout (mock >15s) → retorna `''`
- [ ] Transcrição retorna string vazia `""` → retorna `''`

### `webhook.audio.test.ts`
- [ ] `is_forwarded=false` → resposta contém transcrição + intent + `1️⃣ Confirmar | 2️⃣ Cancelar`
- [ ] `is_forwarded=true` + ação clara → transcrição + sugestão + confirm/cancel
- [ ] `is_forwarded=true` + UNKNOWN → pergunta aberta
- [ ] Transcrição vazia → fallback amigável
- [ ] Token inválido → 401
- [ ] Campo `audio` ausente → 400
- [ ] Arquivo >10MB → 413
- [ ] Segundo áudio sem confirmar → pending sobrescrito

### `baileys` (integração manual / smoke test)
- [ ] PTT enviado → Baileys loga download + POST para `/webhook/baileys-audio`
- [ ] `downloadMediaMessage` lança exceção → Baileys não crasha
- [ ] `audioMessage` com `audio/mp4` → mimetype correto no multipart

---

## 7. Dependências e configuração

**Sem novas variáveis de ambiente** — reutiliza `GROQ_API_KEY` e `BAILEYS_WEBHOOK_SECRET`.

**Novo método em `apps/api/src/lib/llmService.ts`:**
```typescript
export async function suggestAction(text: string): Promise<{ action: string; title: string } | null>
```
Prompt dedicado para contexto de terceiro: extrai ação sugerida (ex: "criar tarefa") e título (ex: "enviar relatório até quinta"). Retorna `null` se não identificar ação clara (→ UNKNOWN).

**Dependência nova em `apps/api`:**
```
multer (multipart/form-data parser)
@types/multer
```

**Dependência nova em `apps/baileys`:**
```
form-data (já transitivo via axios, mas declarar explicitamente)
```

---

## 8. Fora de escopo

- Transcrição de vídeos
- Resposta em áudio (text-to-speech)
- Armazenamento do áudio original no banco
- Suporte a múltiplos idiomas (fixado em `pt` por ora)
