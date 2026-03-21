import type { WhatsAppAdapter } from '../types';

export class MockAdapter implements WhatsAppAdapter {
  async send(to: string, text: string): Promise<void> {
    console.log(`[MOCK WhatsApp] → ${to}: ${text}`);
  }
}
