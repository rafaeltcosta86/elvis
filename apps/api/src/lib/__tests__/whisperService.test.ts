import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Import after mocks
let transcribeAudio: (buffer: Buffer, mimetype: string) => Promise<string>;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  process.env.GROQ_API_KEY = 'test-key';
  const mod = await import('../whisperService');
  transcribeAudio = mod.transcribeAudio;
});

describe('transcribeAudio', () => {
  it('retorna texto transcrito quando Groq responde com sucesso', async () => {
    (mockedAxios.post as any).mockResolvedValueOnce({
      data: { text: 'lembra de ligar pra Linic amanhã' },
    });
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/ogg; codecs=opus');
    expect(result).toBe('lembra de ligar pra Linic amanhã');
  });

  it('retorna string vazia quando buffer tem 0 bytes', async () => {
    const result = await transcribeAudio(Buffer.alloc(0), 'audio/ogg');
    expect(result).toBe('');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('retorna string vazia quando GROQ_API_KEY está ausente', async () => {
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    const mod = await import('../whisperService');
    const fn = mod.transcribeAudio;
    const result = await fn(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('retorna string vazia quando Groq retorna objeto malformado', async () => {
    (mockedAxios.post as any).mockResolvedValueOnce({ data: {} });
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('');
  });

  it('retorna string vazia quando Groq retorna text vazio', async () => {
    (mockedAxios.post as any).mockResolvedValueOnce({ data: { text: '' } });
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('');
  });

  it('retorna string vazia e não lança quando Groq dá erro de rede', async () => {
    (mockedAxios.post as any).mockRejectedValueOnce(new Error('Network Error'));
    await expect(transcribeAudio(Buffer.from('audio'), 'audio/ogg')).resolves.toBe('');
  });

  it('passa mimetype correto no FormData e usa whisper-large-v3-turbo', async () => {
    (mockedAxios.post as any).mockResolvedValueOnce({ data: { text: 'ok' } });
    await transcribeAudio(Buffer.from('audio'), 'audio/mp4');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        timeout: 15000,
      })
    );
  });

  it('passa parâmetro prompt no FormData', async () => {
    (mockedAxios.post as any).mockResolvedValueOnce({ data: { text: 'ok' } });
    await transcribeAudio(Buffer.from('audio'), 'audio/ogg');

    const formData = (mockedAxios.post as any).mock.calls[0][1] as any;
    // FormData do pacote 'form-data' usa internal _streams
    const promptPart = formData._streams.find((s: any) => typeof s === 'string' && s.includes('name="prompt"'));
    expect(promptPart).toBeDefined();

    const promptValue = formData._streams[formData._streams.indexOf(promptPart) + 1];
    expect(promptValue).toBe('Claude Code, Anthropic, Elvis, Rafael');
  });

  it('usa WHISPER_PROMPT da variável de ambiente se presente', async () => {
    process.env.WHISPER_PROMPT = 'Custom Prompt, Test';
    (mockedAxios.post as any).mockResolvedValueOnce({ data: { text: 'ok' } });
    await transcribeAudio(Buffer.from('audio'), 'audio/ogg');

    const formData = (mockedAxios.post as any).mock.calls[0][1] as any;
    const promptValue = formData._streams[formData._streams.findIndex((s: any) => typeof s === 'string' && s.includes('name="prompt"')) + 1];
    expect(promptValue).toBe('Custom Prompt, Test');

    delete process.env.WHISPER_PROMPT;
  });
});
