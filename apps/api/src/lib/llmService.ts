export type LLMClassification =
  | { intent: 'REGISTER_ALIAS'; alias: string; contact_name: string }
  | { intent: 'CREATE_CONTACT'; contact_name: string; phone: string; owner_alias?: string }
  | { intent: 'SET_OWNER_ALIAS'; contact_name: string; owner_alias: string }
  | { intent: 'EDIT_CONTACT'; contact_name: string; field: 'name' | 'alias' | 'phone'; new_value: string }
  | { intent: 'DELETE_CONTACT'; contact_identifier: string }
  | { intent: 'CREATE_EVENT'; title: string; date: string; time: string; duration_min: number; contact_name?: string }
  | { intent: 'INTRODUCE_SELF'; contact_name: string; context?: string }
  | { intent: 'SEND_MESSAGE'; contact_name: string; message: string }
  | { intent: 'UNKNOWN' };

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PROMPT_SYSTEM = `Você é um classificador de intenções para um assistente pessoal chamado Elvis.
Analise a mensagem e retorne JSON com UMA destas estruturas:

- Enviar mensagem para um contato: {"intent":"SEND_MESSAGE","contact_name":"<nome>","message":"<mensagem exata do usuário>"}
  Use quando o usuário quiser mandar uma mensagem, falar algo, avisar ou perguntar algo a alguém.
  IMPORTANTE: Extraia a mensagem FIELMENTE ao que o usuário disse, preservando o tom (pergunta, afirmação, etc.).
  Ex: "manda uma mensagem para o Guilherme perguntando se ele já instalou o Claude Code" -> {"intent":"SEND_MESSAGE","contact_name":"Guilherme","message":"perguntando se ele já instalou o Claude Code"}

- Criação de NOVO contato com número de telefone: {"intent":"CREATE_CONTACT","contact_name":"<nome>","phone":"<somente dígitos, ex: 5511999990000>","owner_alias":"<opcional: como o dono quer ser chamado por este contato>"}
  Use quando a mensagem contiver um número de telefone E o usuário quiser cadastrar/criar/adicionar um contato.
  Se a mensagem mencionar interação, apelido ou como o dono quer ser chamado, inclua em owner_alias.
  Ex: "cria o contato Carlinha, número 5511999, interação Rafa" → owner_alias="Rafa"

- Registro de atalho para contato JÁ EXISTENTE (sem número, com atalho tipo /nome): {"intent":"REGISTER_ALIAS","alias":"<atalho>","contact_name":"<nome>"}
  Use APENAS quando houver um atalho explícito (começa com /) e NÃO houver número de telefone.

- Alteração de como o dono se identifica com um contato: {"intent":"SET_OWNER_ALIAS","contact_name":"<nome>","owner_alias":"<como o dono quer ser chamado>"}
  Use quando pedirem para mudar/alterar/definir como o dono aparece ou se chama para um contato específico.
  Ex: "agora sou o pai pra Estela", "muda meu nome pra Linic para Rafa", "altere a interação com a Amanda para Amor"

- Edição de contato: {"intent":"EDIT_CONTACT","contact_name":"<nome atual ou alias>","field":"<name|alias|phone>","new_value":"<novo valor>"}
  Use quando o usuário quiser alterar o nome, alias/atalho ou telefone de um contato existente.
  Ex: "mude o nome do Siqueira para Rafa Siqueira" -> {"intent":"EDIT_CONTACT","contact_name":"Siqueira","field":"name","new_value":"Rafa Siqueira"}
  Ex: "altera o telefone da Amanda para 5511988887777" -> {"intent":"EDIT_CONTACT","contact_name":"Amanda","field":"phone","new_value":"5511988887777"}
  Ex: "troca o alias do João para /jao" -> {"intent":"EDIT_CONTACT","contact_name":"João","field":"alias","new_value":"/jao"}

- Deleção de contato: {"intent":"DELETE_CONTACT","contact_identifier":"<nome ou alias mencionado>"}
  Use quando o usuário quiser deletar, remover, apagar ou excluir um contato da lista.
  Ex: "delete o contato Siqueira", "remove o contato /siqueira", "apaga o contato João da minha lista"

- Criação de evento no calendário: {"intent":"CREATE_EVENT","title":"<título do evento>","date":"<data no formato YYYY-MM-DD ou relativa como 'quinta','amanhã','sexta'>","time":"<hora no formato HH:MM>","duration_min":<duração em minutos, padrão 60>,"contact_name":"<opcional: nome do participante>"}
  Use quando o usuário quiser agendar, marcar, criar uma reunião, evento, compromisso ou lembrança com hora.
  Ex: "marca uma reunião com a Linic quinta às 15h" → {"intent":"CREATE_EVENT","title":"Reunião com Linic","date":"quinta","time":"15:00","duration_min":60,"contact_name":"Linic"}
  Ex: "agenda call com o João amanhã às 10h, 30 minutos" → {"intent":"CREATE_EVENT","title":"Call com João","date":"amanhã","time":"10:00","duration_min":30,"contact_name":"João"}

- Apresentação de Elvis para um contato: {"intent":"INTRODUCE_SELF","contact_name":"<nome>","context":"<opcional: contexto da relação mencionado>"}
  Use quando o usuário pedir para o Elvis se apresentar a alguém, informar quem ele é ou iniciar contato.
  Ex: "se apresenta pro João, diz que trabalhamos juntos na McKinsey" → {"intent":"INTRODUCE_SELF","contact_name":"João","context":"trabalhamos juntos na McKinsey"}
  Ex: "se apresenta pro João" → {"intent":"INTRODUCE_SELF","contact_name":"João"}

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
  IMPORTANTE: Extraia a mensagem FIELMENTE ao que o usuário disse.
  NÃO adicione framing como "${ownerName} mandou dizer" ou "${ownerName} pediu".
  Exemplos:
    "Manda um oi pra Amanda" → "manda para Amanda: oi"
    "Diga para Estela que o RG dela está na casa da Karen" → "manda para Estela: seu RG está na casa da Karen"
    "Fala pra João que eu chego às 18h" → "manda para João: eu chego às 18h"

Para qualquer outro tipo de comando (tarefa, lembrete, etc.): responda APENAS com o texto limpo e objetivo.
  "Lembra de comprar pão amanhã" → "comprar pão amanhã"

Responda APENAS com o comando normalizado. Nenhum texto adicional.`;
}

export async function normalizeAudioCommand(text: string, ownerAlias?: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return text;

  const ownerName = ownerAlias ?? process.env.OWNER_NAME ?? 'o dono';

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
      return {
        intent: 'CREATE_CONTACT',
        contact_name: parsed.contact_name,
        phone: String(parsed.phone),
        ...(parsed.owner_alias ? { owner_alias: String(parsed.owner_alias) } : {}),
      };
    }
    if (parsed.intent === 'SET_OWNER_ALIAS' && parsed.contact_name && parsed.owner_alias) {
      return { intent: 'SET_OWNER_ALIAS', contact_name: parsed.contact_name, owner_alias: String(parsed.owner_alias) };
    }
    if (
      parsed.intent === 'EDIT_CONTACT' &&
      parsed.contact_name &&
      ['name', 'alias', 'phone'].includes(parsed.field) &&
      parsed.new_value
    ) {
      return {
        intent: 'EDIT_CONTACT',
        contact_name: String(parsed.contact_name),
        field: parsed.field as 'name' | 'alias' | 'phone',
        new_value: String(parsed.new_value),
      };
    }
    if (parsed.intent === 'CREATE_EVENT' && parsed.title && parsed.date && parsed.time) {
      return {
        intent: 'CREATE_EVENT',
        title: String(parsed.title),
        date: String(parsed.date),
        time: String(parsed.time),
        duration_min: typeof parsed.duration_min === 'number' ? parsed.duration_min : 60,
        ...(parsed.contact_name ? { contact_name: String(parsed.contact_name) } : {}),
      };
    }
    if (parsed.intent === 'DELETE_CONTACT' && parsed.contact_identifier) {
      return { intent: 'DELETE_CONTACT', contact_identifier: String(parsed.contact_identifier) };
    }
    if (parsed.intent === 'INTRODUCE_SELF' && parsed.contact_name) {
      return {
        intent: 'INTRODUCE_SELF',
        contact_name: String(parsed.contact_name),
        ...(parsed.context ? { context: String(parsed.context) } : {}),
      };
    }
    if (parsed.intent === 'SEND_MESSAGE' && parsed.contact_name && parsed.message) {
      return {
        intent: 'SEND_MESSAGE',
        contact_name: String(parsed.contact_name),
        message: String(parsed.message),
      };
    }
    return { intent: 'UNKNOWN' };
  } catch {
    return { intent: 'UNKNOWN' };
  }
}


export async function generateIntroduction(
  contactName: string,
  context?: string,
  ownerAlias?: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return `Olá ${contactName}, eu sou o Elvis, assistente do ${ownerAlias ?? 'Rafael'}.`;

  const ownerName = ownerAlias ?? process.env.OWNER_NAME ?? 'Rafael';
  const systemPrompt = `Você é o Elvis, um assistente pessoal inteligente e natural do ${ownerName}.
Sua tarefa é escrever uma mensagem de apresentação para um novo contato chamado ${contactName}.
${context ? `O contexto da relação é: ${context}.` : ''}

Diretrizes:
- Seja educado, profissional mas com um toque de naturalidade.
- Identifique-se como Elvis, assistente do ${ownerName}.
- Se houver contexto, incorpore-o naturalmente na mensagem para que o contato saiba de quem você está falando.
- A mensagem deve ser curta e objetiva, adequada para WhatsApp.
- NÃO use emojis em excesso.
- NÃO use placeholders.

Escreva apenas o texto da mensagem.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return (data?.choices?.[0]?.message?.content ?? '').trim();
  } catch {
    return `Olá ${contactName}, eu sou o Elvis, assistente do ${ownerName}.`;
  }
}
