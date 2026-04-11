import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { classifyIntent, normalizeAudioCommand, type LLMClassification } from '../llmService';

function groqResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = 'test-key';
});

describe('classifyIntent', () => {
  it('returns REGISTER_ALIAS when LLM detects alias registration intent', async () => {
    mockFetch.mockResolvedValue(
      groqResponse('{"intent":"REGISTER_ALIAS","alias":"/li","contact_name":"Linic"}')
    );

    const result = await classifyIntent('de agora em diante /li é a Linic');

    expect(result).toEqual<LLMClassification>({
      intent: 'REGISTER_ALIAS',
      alias: '/li',
      contact_name: 'Linic',
    });
  });

  it('returns UNKNOWN for unrelated messages', async () => {
    mockFetch.mockResolvedValue(
      groqResponse('{"intent":"UNKNOWN"}')
    );

    const result = await classifyIntent('comprar pão amanhã');

    expect(result).toEqual<LLMClassification>({ intent: 'UNKNOWN' });
  });

  it('returns UNKNOWN when LLM returns malformed JSON', async () => {
    mockFetch.mockResolvedValue(groqResponse('não sei'));
    const result = await classifyIntent('qualquer coisa');
    expect(result).toEqual<LLMClassification>({ intent: 'UNKNOWN' });
  });

  it('returns UNKNOWN when API key is not configured', async () => {
    delete process.env.GROQ_API_KEY;
    const result = await classifyIntent('qualquer coisa');
    expect(result).toEqual<LLMClassification>({ intent: 'UNKNOWN' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await classifyIntent('qualquer coisa');
    expect(result).toEqual<LLMClassification>({ intent: 'UNKNOWN' });
  });
});

describe('normalizeAudioCommand', () => {
  it('normaliza "Manda um oi pra Amanda" → "manda para Amanda: oi"', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Amanda: oi'));
    const result = await normalizeAudioCommand('Manda um oi pra Amanda.');
    expect(result).toBe('manda para Amanda: oi');
  });

  it('reformula perspectiva: "Diga para Estela que o RG dela está na casa da Karen"', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Estela: seu RG está na casa da Karen'));
    const result = await normalizeAudioCommand('Diga para Estela que o RG dela está na casa da Karen');
    expect(result).toBe('manda para Estela: seu RG está na casa da Karen');
  });

  it('inclui atribuição neutra quando dono pede para "falar que eu disse"', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Estela: ele pediu pra te avisar: seu RG está na casa da Karen'));
    const result = await normalizeAudioCommand('Fala pra Estela que eu pedi pra avisar que o RG dela tá na casa da Karen');
    expect(result).toBe('manda para Estela: ele pediu pra te avisar: seu RG está na casa da Karen');
  });

  it('retorna texto limpo para comandos sem envio: "lembra de comprar pão"', async () => {
    mockFetch.mockResolvedValue(groqResponse('comprar pão'));
    const result = await normalizeAudioCommand('lembra de comprar pão amanhã');
    expect(result).toBe('comprar pão');
  });

  it('retorna o texto original quando API key está ausente', async () => {
    delete process.env.GROQ_API_KEY;
    const result = await normalizeAudioCommand('Manda um oi pra Amanda.');
    expect(result).toBe('Manda um oi pra Amanda.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retorna o texto original quando LLM falha', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await normalizeAudioCommand('Manda um oi pra Amanda.');
    expect(result).toBe('Manda um oi pra Amanda.');
  });
});
