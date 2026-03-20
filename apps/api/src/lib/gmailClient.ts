import { google } from 'googleapis';
import { getTokenForProvider } from './oauthService';
import type { NormalizedEmail } from './types/email';

interface GmailClient {
  listTodayEmails(): Promise<NormalizedEmail[]>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

/**
 * Creates a Gmail API client authenticated with the stored Google OAuth token.
 * Throws if no token is stored or if the token format is invalid.
 */
export async function createGmailClient(): Promise<GmailClient> {
  const blob = await getTokenForProvider('GOOGLE');
  if (!blob) {
    throw new Error('No Google OAuth token found. Run the gmail-oauth-bootstrap script first.');
  }

  let credentials: { access_token: string; refresh_token: string; expiry_date: number };
  try {
    credentials = JSON.parse(blob);
  } catch {
    throw new Error('Invalid Google token format — re-run gmail-oauth-bootstrap');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials(credentials);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  return {
    listTodayEmails: () => listTodayEmails(gmail),
    sendEmail: (to, subject, body) => sendEmailViaGmail(gmail, to, subject, body),
  };
}

async function listTodayEmails(gmail: any): Promise<NormalizedEmail[]> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}/${pad(tomorrow.getMonth() + 1)}/${pad(tomorrow.getDate())}`;

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${todayStr} before:${tomorrowStr}`,
    maxResults: 50,
  });

  const messages: Array<{ id: string }> = listRes.data.messages ?? [];
  if (messages.length === 0) return [];

  const emails = await Promise.all(
    messages.map((msg) =>
      gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date', 'In-Reply-To'],
      })
    )
  );

  return emails.map((res) => normalizeGmailMessage(res.data));
}

function normalizeGmailMessage(data: any): NormalizedEmail {
  const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const date = getHeader('Date');
  const inReplyTo = getHeader('In-Reply-To');

  return {
    id: data.id,
    from: extractEmail(from),
    subject,
    receivedAt: date ? new Date(date).toISOString() : '',
    isReply: !!inReplyTo,
    snippet: data.snippet ?? '',
  };
}

async function sendEmailViaGmail(
  gmail: any,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const raw = buildRfc2822Message(to, subject, body);
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
}

function buildRfc2822Message(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\r\n');
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function extractEmail(from: string): string {
  const match = /<(.+?)>/.exec(from);
  return match ? match[1] : from.trim();
}
