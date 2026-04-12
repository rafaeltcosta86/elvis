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

  it('returns CREATE_CONTACT with phone', async () => {
    mockFetch.mockResolvedValue(
      groqResponse('{"intent":"CREATE_CONTACT","contact_name":"Carlinha","phone":"5511999990000"}')
    );
    const result = await classifyIntent('cria o contato Carlinha, número 5511999990000');
    expect(result).toEqual<LLMClassification>({
      intent: 'CREATE_CONTACT',
      contact_name: 'Carlinha',
      phone: '5511999990000',
    });
  });

  it('returns CREATE_CONTACT with optional owner_alias', async () => {
    mockFetch.mockResolvedValue(
      groqResponse('{"intent":"CREATE_CONTACT","contact_name":"Carlinha","phone":"5511999990000","owner_alias":"Rafa"}')
    );
    const result = await classifyIntent('cria o contato Carlinha, número 5511999990000, interação Rafa');
    expect(result).toEqual<LLMClassification>({
      intent: 'CREATE_CONTACT',
      contact_name: 'Carlinha',
      phone: '5511999990000',
      owner_alias: 'Rafa',
    });
  });

  it('returns SET_OWNER_ALIAS', async () => {
    mockFetch.mockResolvedValue(
      groqResponse('{"intent":"SET_OWNER_ALIAS","contact_name":"Estela","owner_alias":"pai"}')
    );
    const result = await classifyIntent('agora sou o pai pra Estela');
    expect(result).toEqual<LLMClassification>({
      intent: 'SET_OWNER_ALIAS',
      contact_name: 'Estela',
      owner_alias: 'pai',
    });
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

  it('usa "mandou dizer" ao repassar informação com nome próprio (sem redundância)', async () => {
    process.env.OWNER_NAME = 'Rafael';
    mockFetch.mockResolvedValue(groqResponse('manda para Estela: Rafael mandou dizer que seu RG está na casa da Karen'));
    const result = await normalizeAudioCommand('Fala pra Estela que eu pedi pra avisar que o RG dela tá na casa da Karen');
    expect(result).toBe('manda para Estela: Rafael mandou dizer que seu RG está na casa da Karen');
  });

  it('usa "teu pai pediu pra você" ao repassar pedido com título de parentesco', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Estela: teu pai pediu pra você voltar a colocar as vogais nas palavras'));
    const result = await normalizeAudioCommand(
      'diga para a Estela que eu pedi para ela voltar a colocar as vogais nas palavras',
      'pai'
    );
    expect(result).toBe('manda para Estela: teu pai pediu pra você voltar a colocar as vogais nas palavras');
    // verifica que o prompt usa "teu pai" e não só "pai"
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain('teu pai');
  });

  it('usa "teu pai mandou dizer" ao repassar informação com título de parentesco', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Estela: teu pai mandou dizer que seu RG está na casa da Karen'));
    const result = await normalizeAudioCommand(
      'fala pra Estela que o RG dela tá na casa da Karen',
      'pai'
    );
    expect(result).toBe('manda para Estela: teu pai mandou dizer que seu RG está na casa da Karen');
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

  it('usa ownerAlias do contato quando fornecido', async () => {
    mockFetch.mockResolvedValue(groqResponse('manda para Linic: Rafa chega às 18h'));
    const result = await normalizeAudioCommand('Fala pra Linic que eu chego às 18h', 'Rafa');
    expect(result).toBe('manda para Linic: Rafa chega às 18h');
    // verifica que o prompt enviado contém "Rafa"
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain('Rafa');
  });
});
