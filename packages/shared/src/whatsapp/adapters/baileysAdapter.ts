import axios from 'axios';
import type { WhatsAppAdapter } from '../types';

export class BaileysAdapter implements WhatsAppAdapter {
  private readonly baileysUrl: string;

  constructor() {
    this.baileysUrl = process.env.BAILEYS_URL ?? 'http://baileys:3001';
  }

  async send(to: string, text: string): Promise<void> {
    await axios.post(
      `${this.baileysUrl}/send`,
      { to, text },
      { timeout: 10_000 }
    );
    console.log(`[Baileys] enviou para ${to}: ${text}`);
  }
}
