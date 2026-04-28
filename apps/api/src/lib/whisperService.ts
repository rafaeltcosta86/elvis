import axios from 'axios';
import FormData from 'form-data';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_WHISPER_PROMPT = 'Claude Code, Anthropic, Elvis, Rafael';

const DEFAULT_PHONETIC_CORRECTIONS: Record<string, string> = {
  'Cloud Code': 'Claude Code',
};

function applyPhoneticCorrections(text: string): string {
  if (!text) return text;

  let corrections = { ...DEFAULT_PHONETIC_CORRECTIONS };
  if (process.env.WHISPER_CORRECTIONS) {
    try {
      const extra = JSON.parse(process.env.WHISPER_CORRECTIONS);
      corrections = { ...corrections, ...extra };
    } catch (err) {
      console.error('[Whisper] erro ao parsear WHISPER_CORRECTIONS:', err);
    }
  }

  let result = text;
  for (const [wrong, right] of Object.entries(corrections)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    result = result.replace(regex, right);
  }

  return result;
}

export async function transcribeAudio(buffer: Buffer, mimetype: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[Whisper] GROQ_API_KEY ausente — transcrição desabilitada');
    return '';
  }

  if (buffer.length === 0) {
    console.warn('[Whisper] buffer de 0 bytes recebido — ignorando');
    return '';
  }

  try {
    const form = new FormData();
    form.append('file', buffer, { filename: 'audio.ogg', contentType: mimetype });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    form.append('prompt', process.env.WHISPER_PROMPT || DEFAULT_WHISPER_PROMPT);

    const response = await axios.post(GROQ_API_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 15000,
    });

    const text: string = response.data?.text ?? '';
    return applyPhoneticCorrections(text.trim());
  } catch (err) {
    console.error('[Whisper] erro na transcrição:', err instanceof Error ? err.message : err);
    return '';
  }
}
