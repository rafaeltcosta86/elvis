import axios from 'axios';

export async function sendWhatsApp(
  to: string,
  text: string
): Promise<void> {
  const apiUrl = process.env.NANOCLAW_API_URL;
  const apiKey = process.env.NANOCLAW_API_KEY;

  // Fallback: mock if no API configured
  if (!apiUrl || !apiKey) {
    console.log(`[MOCK] enviaria para ${to}: ${text}`);
    return;
  }

  try {
    await axios.post(
      `${apiUrl}/messages`,
      { to, text },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`[NANOCLAW] enviou para ${to}: ${text}`);
  } catch (err) {
    console.error('[NANOCLAW] erro ao enviar:', err instanceof Error ? err.message : err);
    // Don't throw — let webhook return 200 even if send failed
  }
}
