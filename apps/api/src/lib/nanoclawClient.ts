import { createWhatsAppService } from '@elvis/shared';
import prisma from './prisma';

const _service = createWhatsAppService(undefined, async (phone) => {
  const contact = await prisma.contact.findFirst({ where: { phone } });
  return !!contact;
});

export async function sendWhatsApp(to: string, text: string): Promise<void> {
  await _service.send(to, text);
}
