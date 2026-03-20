import { sendWhatsApp } from './nanoclawClient';

export async function sendMessage(
  to: string,
  text: string
): Promise<void> {
  await sendWhatsApp(to, text);
}
