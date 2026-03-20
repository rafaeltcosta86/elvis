export interface NormalizedEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string; // ISO string
  isReply: boolean;
  snippet: string;
}
