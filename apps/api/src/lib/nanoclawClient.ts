import { createWhatsAppService } from '@elvis/shared';

const _service = createWhatsAppService();

export async function sendWhatsApp(to: string, text: string): Promise<void> {
  await _service.send(to, text);
}
