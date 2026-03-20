import { formatInTimeZone } from 'date-fns-tz';
import { getToken } from './oauthService';
import { graphGet, graphPost } from './graphClient';
import type { NormalizedEmail } from './types/email';

const TZ = 'America/Sao_Paulo';

/**
 * Fetch today's emails from Microsoft Outlook via Graph API.
 * Returns normalized email objects.
 */
export async function listTodayEmails(): Promise<NormalizedEmail[]> {
  const token = await getToken();
  if (!token) {
    throw new Error('No Microsoft OAuth token found. Run the OAuth bootstrap script first.');
  }

  const now = new Date();
  const todayStart = formatInTimeZone(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
    TZ,
    "yyyy-MM-dd'T'HH:mm:ssxxx"
  );
  const todayEnd = formatInTimeZone(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0),
    TZ,
    "yyyy-MM-dd'T'HH:mm:ssxxx"
  );

  const url =
    `/me/messages` +
    `?$filter=receivedDateTime ge ${todayStart} and receivedDateTime lt ${todayEnd}` +
    `&$top=50` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview` +
    `&$orderby=receivedDateTime desc`;

  const response = await graphGet(url);
  const messages: any[] = response.data.value ?? [];

  return messages.map(normalizeMessage);
}

/**
 * Send an email via Microsoft Graph API.
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  await graphPost('/me/sendMail', {
    message: {
      subject,
      body: {
        contentType: 'Text',
        content: body,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  });
}

function normalizeMessage(msg: any): NormalizedEmail {
  const from: string = msg.from?.emailAddress?.address ?? '';
  const subject: string = msg.subject ?? '';
  const isReply = subject.startsWith('Re:') || subject.startsWith('RES:');

  return {
    id: msg.id,
    from,
    subject,
    receivedAt: msg.receivedDateTime ?? '',
    isReply,
    snippet: msg.bodyPreview ?? '',
  };
}
