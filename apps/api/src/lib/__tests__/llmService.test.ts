import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { classifyIntent, type LLMClassification } from '../llmService';

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
