import axios from 'axios';
import type { WhatsAppAdapter } from '../types';

export class NanoclawAdapter implements WhatsAppAdapter {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async send(to: string, text: string): Promise<void> {
    await axios.post(
      `${this.apiUrl}/messages`,
      { to, text },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`[NanoClaw] enviou para ${to}: ${text}`);
  }
}
