import { getToken, getTokenForProvider } from './oauthService';
import { listTodayEmails as outlookListTodayEmails } from './outlookMailClient';
import { createGmailClient } from './gmailClient';
import { classifyImportance } from './emailClassifier';
import type { NormalizedEmail } from './types/email';

export interface EmailSummaryResult {
  outlook: { important: NormalizedEmail[]; total: number };
  gmail: { important: NormalizedEmail[]; total: number };
}

/**
 * Fetches today's emails from both Outlook and Gmail, classifies them,
 * and returns a summary. Throws if tokens are not configured or if
 * either provider fails.
 */
export async function getEmailSummary(): Promise<EmailSummaryResult> {
  // Verify tokens before fetching
  const [msToken, googleBlob] = await Promise.all([
    getToken(),
    getTokenForProvider('GOOGLE'),
  ]);

  if (!msToken) {
    throw new Error('Outlook OAuth not configured. Run the Microsoft OAuth bootstrap script.');
  }
  if (!googleBlob) {
    throw new Error('Gmail OAuth not configured. Run the gmail-oauth-bootstrap script.');
  }

  // Fetch from both providers; any rejection propagates as 502
  const gmailClient = await createGmailClient();
  const [outlookEmails, gmailEmails] = await Promise.all([
    outlookListTodayEmails(),
    gmailClient.listTodayEmails(),
  ]);

  return {
    outlook: {
      important: outlookEmails.filter(classifyImportance),
      total: outlookEmails.length,
    },
    gmail: {
      important: gmailEmails.filter(classifyImportance),
      total: gmailEmails.length,
    },
  };
}
