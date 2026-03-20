import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../oauthService', () => ({
  getToken: vi.fn(),
  getTokenForProvider: vi.fn(),
}));

vi.mock('../outlookMailClient', () => ({
  listTodayEmails: vi.fn(),
}));

vi.mock('../gmailClient', () => ({
  createGmailClient: vi.fn(),
}));

vi.mock('../emailClassifier', () => ({
  classifyImportance: vi.fn(),
}));

import { getEmailSummary } from '../emailService';
import { getToken, getTokenForProvider } from '../oauthService';
import { listTodayEmails as outlookListTodayEmails } from '../outlookMailClient';
import { createGmailClient } from '../gmailClient';
import { classifyImportance } from '../emailClassifier';
import type { NormalizedEmail } from '../types/email';

function makeEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: 'e1',
    from: 'x@y.com',
    subject: 'Subject',
    receivedAt: '2026-03-19T10:00:00Z',
    isReply: false,
    snippet: '',
    ...overrides,
  };
}

describe('getEmailSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when no Microsoft token is configured', async () => {
    (getToken as any).mockResolvedValue(null);
    (getTokenForProvider as any).mockResolvedValue('google-blob');

    await expect(getEmailSummary()).rejects.toThrow('Outlook OAuth not configured');
  });

  it('should throw when no Google token is configured', async () => {
    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue(null);

    await expect(getEmailSummary()).rejects.toThrow('Gmail OAuth not configured');
  });

  it('should throw 502-style error when Outlook fetch fails', async () => {
    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue('google-blob');
    (outlookListTodayEmails as any).mockRejectedValue(new Error('Graph error'));
    (createGmailClient as any).mockResolvedValue({ listTodayEmails: vi.fn().mockResolvedValue([]) });

    await expect(getEmailSummary()).rejects.toThrow();
  });

  it('should throw when Gmail fetch fails', async () => {
    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue('google-blob');
    (outlookListTodayEmails as any).mockResolvedValue([]);
    (createGmailClient as any).mockResolvedValue({
      listTodayEmails: vi.fn().mockRejectedValue(new Error('Gmail error')),
    });

    await expect(getEmailSummary()).rejects.toThrow();
  });

  it('should return correct total counts for both providers', async () => {
    const outlookEmails = [makeEmail({ id: 'o1' }), makeEmail({ id: 'o2' })];
    const gmailEmails = [makeEmail({ id: 'g1' })];

    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue('google-blob');
    (outlookListTodayEmails as any).mockResolvedValue(outlookEmails);
    (createGmailClient as any).mockResolvedValue({
      listTodayEmails: vi.fn().mockResolvedValue(gmailEmails),
    });
    (classifyImportance as any).mockReturnValue(false);

    const result = await getEmailSummary();

    expect(result.outlook.total).toBe(2);
    expect(result.gmail.total).toBe(1);
  });

  it('should apply classifyImportance to filter important emails', async () => {
    const importantEmail = makeEmail({ id: 'o1', isReply: true });
    const normalEmail = makeEmail({ id: 'o2' });

    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue('google-blob');
    (outlookListTodayEmails as any).mockResolvedValue([importantEmail, normalEmail]);
    (createGmailClient as any).mockResolvedValue({
      listTodayEmails: vi.fn().mockResolvedValue([]),
    });
    (classifyImportance as any).mockImplementation((e: NormalizedEmail) => e.isReply);

    const result = await getEmailSummary();

    expect(result.outlook.important).toHaveLength(1);
    expect(result.outlook.important[0].id).toBe('o1');
    expect(result.outlook.total).toBe(2);
  });

  it('should return empty important arrays when all emails are unimportant', async () => {
    (getToken as any).mockResolvedValue('ms-token');
    (getTokenForProvider as any).mockResolvedValue('google-blob');
    (outlookListTodayEmails as any).mockResolvedValue([makeEmail()]);
    (createGmailClient as any).mockResolvedValue({
      listTodayEmails: vi.fn().mockResolvedValue([makeEmail({ id: 'g1' })]),
    });
    (classifyImportance as any).mockReturnValue(false);

    const result = await getEmailSummary();

    expect(result.outlook.important).toEqual([]);
    expect(result.gmail.important).toEqual([]);
  });
});
