import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listTodayEmails, sendEmail } from '../outlookMailClient';

vi.mock('../oauthService', () => ({
  getToken: vi.fn(),
}));

vi.mock('../graphClient', () => ({
  graphGet: vi.fn(),
  graphPost: vi.fn(),
}));

import { getToken } from '../oauthService';
import { graphGet, graphPost } from '../graphClient';

describe('outlookMailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTodayEmails', () => {
    it('should throw when no Microsoft token is stored', async () => {
      (getToken as any).mockResolvedValue(null);

      await expect(listTodayEmails()).rejects.toThrow(
        'No Microsoft OAuth token found'
      );
    });

    it('should call graphGet with $filter for today', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockResolvedValue({ data: { value: [] } });

      await listTodayEmails();

      expect(graphGet).toHaveBeenCalledTimes(1);
      const url: string = (graphGet as any).mock.calls[0][0];
      expect(url).toContain('/me/messages');
      expect(url).toContain('$filter=');
      expect(url).toContain('receivedDateTime');
    });

    it('should return normalized email objects', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockResolvedValue({
        data: {
          value: [
            {
              id: 'msg-1',
              from: { emailAddress: { address: 'sender@example.com', name: 'Sender' } },
              subject: 'Test subject',
              receivedDateTime: '2026-03-19T08:00:00Z',
              bodyPreview: 'Test snippet',
            },
          ],
        },
      });

      const emails = await listTodayEmails();

      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({
        id: 'msg-1',
        from: 'sender@example.com',
        subject: 'Test subject',
        receivedAt: '2026-03-19T08:00:00Z',
        isReply: false,
        snippet: 'Test snippet',
      });
    });

    it('should set isReply=true when subject starts with Re:', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockResolvedValue({
        data: {
          value: [
            {
              id: 'msg-2',
              from: { emailAddress: { address: 'x@y.com', name: 'X' } },
              subject: 'Re: Original subject',
              receivedDateTime: '2026-03-19T09:00:00Z',
              bodyPreview: '',
            },
          ],
        },
      });

      const emails = await listTodayEmails();

      expect(emails[0].isReply).toBe(true);
    });

    it('should set isReply=true when subject starts with RES:', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockResolvedValue({
        data: {
          value: [
            {
              id: 'msg-3',
              from: { emailAddress: { address: 'a@b.com', name: 'A' } },
              subject: 'RES: Original',
              receivedDateTime: '2026-03-19T10:00:00Z',
              bodyPreview: '',
            },
          ],
        },
      });

      const emails = await listTodayEmails();

      expect(emails[0].isReply).toBe(true);
    });

    it('should return empty array when no messages', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockResolvedValue({ data: { value: [] } });

      const emails = await listTodayEmails();

      expect(emails).toEqual([]);
    });

    it('should rethrow Graph API errors', async () => {
      (getToken as any).mockResolvedValue('access_token');
      (graphGet as any).mockRejectedValue(new Error('Graph API error'));

      await expect(listTodayEmails()).rejects.toThrow('Graph API error');
    });
  });

  describe('sendEmail', () => {
    it('should call graphPost with /me/sendMail and correct body shape', async () => {
      (graphPost as any).mockResolvedValue({});

      await sendEmail('to@example.com', 'Hello', 'Body text');

      expect(graphPost).toHaveBeenCalledWith(
        '/me/sendMail',
        expect.objectContaining({
          message: expect.objectContaining({
            subject: 'Hello',
            body: expect.objectContaining({ contentType: 'Text', content: 'Body text' }),
            toRecipients: [
              { emailAddress: { address: 'to@example.com' } },
            ],
          }),
          saveToSentItems: true,
        })
      );
    });

    it('should rethrow Graph API errors on send', async () => {
      (graphPost as any).mockRejectedValue(new Error('Send failed'));

      await expect(sendEmail('to@example.com', 'Subject', 'Body')).rejects.toThrow('Send failed');
    });
  });
});
