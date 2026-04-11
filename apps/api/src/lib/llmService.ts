export type LLMClassification =
  | { intent: 'REGISTER_ALIAS'; alias: string; contact_name: string }
  | { intent: 'CREATE_CONTACT'; contact_name: string; phone: string }
  | { intent: 'UNKNOWN' };

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PROMPT_SYSTEM = `Você é um classificador de intenções para um assistente pessoal chamado Elvis.
Analise a mensagem e retorne JSON com UMA destas estruturas:

- Criação de NOVO contato com número de telefone: {"intent":"CREATE_CONTACT","contact_name":"<nome>","phone":"<somente dígitos, ex: 5511999990000>"}
  Use quando a mensagem contiver um número de telefone E o usuário quiser cadastrar/criar/adicionar um contato.

- Registro de atalho para contato JÁ EXISTENTE (sem número, com atalho tipo /nome): {"intent":"REGISTER_ALIAS","alias":"<atalho>","contact_name":"<nome>"}
  Use APENAS quando houver um atalho explícito (começa com /) e NÃO houver número de telefone.

- Qualquer outra coisa: {"intent":"UNKNOWN"}

Responda APENAS com o JSON, sem texto adicional.`;

export type SuggestedAction = { action: string; title: string } | null;

const PROMPT_SUGGEST_SYSTEM = `Você é um assistente pessoal chamado Elvis. Receberá a transcrição de um áudio enviado por um terceiro.
Analise o conteúdo e retorne JSON com a ação sugerida:

- Se identificar uma ação clara: {"action":"<tipo de ação, ex: criar tarefa, agendar reunião>","title":"<descrição curta da tarefa>"}
- Se não identificar ação clara: {"action":"UNKNOWN"}

Responda APENAS com o JSON, sem texto adicional.`;

export async function suggestAction(text: string): Promise<SuggestedAction> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: PROMPT_SUGGEST_SYSTEM },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);

    if (parsed.action === 'UNKNOWN' || !parsed.action || !parsed.title) return null;
    return { action: parsed.action, title: parsed.title };
  } catch {
    return null;
  }
}

function buildNormalizePrompt(ownerName: string): string {
  return `Você é o assistente Elvis. Converte transcrições de áudio do dono (${ownerName}) em comandos estruturados.

Se o dono quer mandar mensagem para alguém: responda APENAS com "manda para <nome>: <mensagem>"
  IMPORTANTE — reformule a mensagem na perspectiva de quem vai receber:
  - Troque pronomes de primeira pessoa pelo nome do dono (${ownerName})
  - Troque "dela" / "seu" para o destinatário conforme o contexto
  - Se o dono pedir para "avisar que eu disse" ou "falar que fui eu": inclua "${ownerName} pediu pra te avisar:" no início
  - A mensagem final deve fazer sentido para quem a recebe, como se fosse enviada diretamente
  Exemplos (dono = ${ownerName}):
    "Manda um oi pra Amanda" → "manda para Amanda: oi"
    "Diga para Estela que o RG dela está na casa da Karen" → "manda para Estela: seu RG está na casa da Karen"
    "Fala pra Estela que eu pedi pra avisar que o RG dela tá na casa da Karen" → "manda para Estela: ${ownerName} pediu pra te avisar: seu RG está na casa da Karen"
    "Fala pra João que eu chego às 18h" → "manda para João: ${ownerName} chega às 18h"

Para qualquer outro tipo de comando (tarefa, lembrete, etc.): responda APENAS com o texto limpo e objetivo.
  "Lembra de comprar pão amanhã" → "comprar pão amanhã"

Responda APENAS com o comando normalizado. Nenhum texto adicional.`;
}

export async function normalizeAudioCommand(text: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return text;

  const ownerName = process.env.OWNER_NAME ?? 'o dono';

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: buildNormalizePrompt(ownerName) },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const normalized = (data?.choices?.[0]?.message?.content ?? '').trim();
    return normalized || text;
  } catch {
    return text;
  }
}

export async function classifyIntent(text: string): Promise<LLMClassification> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { intent: 'UNKNOWN' };

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: PROMPT_SYSTEM },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);

    if (parsed.intent === 'REGISTER_ALIAS' && parsed.alias && parsed.contact_name) {
      return { intent: 'REGISTER_ALIAS', alias: parsed.alias, contact_name: parsed.contact_name };
    }
    if (parsed.intent === 'CREATE_CONTACT' && parsed.contact_name && parsed.phone) {
      return { intent: 'CREATE_CONTACT', contact_name: parsed.contact_name, phone: String(parsed.phone) };
    }
    return { intent: 'UNKNOWN' };
  } catch {
    return { intent: 'UNKNOWN' };
  }
}
