export interface WhatsAppAdapter {
  send(to: string, text: string): Promise<void>;
}
