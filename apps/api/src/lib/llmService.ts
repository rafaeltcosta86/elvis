export type LLMClassification =
  | { intent: 'REGISTER_ALIAS'; alias: string; contact_name: string }
  | { intent: 'UNKNOWN' };

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PROMPT_SYSTEM = `Você é um classificador de intenções para um assistente pessoal chamado Elvis.
Analise a mensagem e retorne JSON com uma destas estruturas:
- Registro de atalho: {"intent":"REGISTER_ALIAS","alias":"<atalho>","contact_name":"<nome>"}
- Qualquer outra coisa: {"intent":"UNKNOWN"}
Responda APENAS com o JSON, sem texto adicional.`;

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

    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);

    if (parsed.intent === 'REGISTER_ALIAS' && parsed.alias && parsed.contact_name) {
      return { intent: 'REGISTER_ALIAS', alias: parsed.alias, contact_name: parsed.contact_name };
    }
    return { intent: 'UNKNOWN' };
  } catch {
    return { intent: 'UNKNOWN' };
  }
}
