import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockMessagesList, mockMessagesGet, mockMessagesSend } = vi.hoisted(() => ({
  mockMessagesList: vi.fn(),
  mockMessagesGet: vi.fn(),
  mockMessagesSend: vi.fn(),
}));

vi.mock('../oauthService', () => ({
  getTokenForProvider: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        messages: {
          list: mockMessagesList,
          get: mockMessagesGet,
          send: mockMessagesSend,
        },
      },
    }),
  },
}));

import { createGmailClient } from '../gmailClient';
import { getTokenForProvider } from '../oauthService';

describe('gmailClient', () => {
  const validBlob = JSON.stringify({
    access_token: 'at',
    refresh_token: 'rt',
    expiry_date: 9999999999999,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  describe('createGmailClient', () => {
    it('should throw when no GOOGLE token is stored', async () => {
      (getTokenForProvider as any).mockResolvedValue(null);

      await expect(createGmailClient()).rejects.toThrow('No Google OAuth token found');
    });

    it('should throw when token blob is invalid JSON', async () => {
      (getTokenForProvider as any).mockResolvedValue('not-json');

      await expect(createGmailClient()).rejects.toThrow('Invalid Google token format');
    });

    it('should return client with listTodayEmails and sendEmail', async () => {
      (getTokenForProvider as any).mockResolvedValue(validBlob);
      mockMessagesList.mockResolvedValue({ data: { messages: [] } });

      const client = await createGmailClient();

      expect(client).toHaveProperty('listTodayEmails');
      expect(client).toHaveProperty('sendEmail');
    });
  });

  describe('listTodayEmails', () => {
    async function getClient() {
      (getTokenForProvider as any).mockResolvedValue(validBlob);
      return createGmailClient();
    }

    it('should query messages with today date filter', async () => {
      mockMessagesList.mockResolvedValue({ data: { messages: [] } });
      const client = await getClient();

      await client.listTodayEmails();

      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          q: expect.stringMatching(/after:\d{4}\/\d{2}\/\d{2}/),
          maxResults: 50,
        })
      );
    });

    it('should return empty array when no messages', async () => {
      mockMessagesList.mockResolvedValue({ data: { messages: null } });
      const client = await getClient();

      const result = await client.listTodayEmails();

      expect(result).toEqual([]);
    });

    it('should fetch full message metadata for each message id', async () => {
      mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg-1' }] } });
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'msg-1',
          snippet: 'snippet text',
          payload: {
            headers: [
              { name: 'From', value: 'Sender Name <sender@test.com>' },
              { name: 'Subject', value: 'Hello world' },
              { name: 'Date', value: 'Thu, 19 Mar 2026 10:00:00 -0300' },
            ],
          },
        },
      });
      const client = await getClient();

      const emails = await client.listTodayEmails();

      expect(mockMessagesGet).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'me', id: 'msg-1', format: 'metadata' })
      );
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({
        id: 'msg-1',
        from: 'sender@test.com',
        subject: 'Hello world',
        isReply: false,
        snippet: 'snippet text',
      });
    });

    it('should set isReply=true when In-Reply-To header is present', async () => {
      mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg-2' }] } });
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'msg-2',
          snippet: '',
          payload: {
            headers: [
              { name: 'From', value: 'a@b.com' },
              { name: 'Subject', value: 'Re: something' },
              { name: 'Date', value: 'Thu, 19 Mar 2026 10:00:00 -0300' },
              { name: 'In-Reply-To', value: '<original@msg.id>' },
            ],
          },
        },
      });
      const client = await getClient();

      const emails = await client.listTodayEmails();

      expect(emails[0].isReply).toBe(true);
    });

    it('should rethrow Gmail API errors', async () => {
      mockMessagesList.mockRejectedValue(new Error('Gmail API error'));
      const client = await getClient();

      await expect(client.listTodayEmails()).rejects.toThrow('Gmail API error');
    });
  });

  describe('sendEmail', () => {
    async function getClient() {
      (getTokenForProvider as any).mockResolvedValue(validBlob);
      return createGmailClient();
    }

    it('should send email using gmail.users.messages.send with base64url encoded message', async () => {
      mockMessagesSend.mockResolvedValue({ data: { id: 'sent-msg-1' } });
      const client = await getClient();

      await client.sendEmail('to@example.com', 'Subject line', 'Body text');

      expect(mockMessagesSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({
            raw: expect.any(String),
          }),
        })
      );
    });

    it('should rethrow send errors', async () => {
      mockMessagesSend.mockRejectedValue(new Error('Send failed'));
      const client = await getClient();

      await expect(client.sendEmail('to@example.com', 'S', 'B')).rejects.toThrow('Send failed');
    });
  });
});
