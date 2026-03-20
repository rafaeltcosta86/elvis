import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';
import prisma from '../prisma';
import axios from 'axios';
import { storeToken, getToken, refreshToken, storeTokenForProvider, getTokenForProvider } from '../oauthService';

vi.mock('../prisma', () => ({
  default: {
    oAuthToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('axios');

describe('oauthService', () => {
  const ENCRYPTION_KEY = '0'.repeat(64); // 32 bytes hex (64 chars)
  const TEST_TOKEN = 'test_access_token_123456789';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OAUTH_ENC_KEY = ENCRYPTION_KEY;
  });

  describe('storeToken', () => {
    it('should encrypt token and upsert with MICROSOFT provider', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await storeToken(TEST_TOKEN);

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const args = mockUpsert.mock.calls[0][0];
      expect(args.where).toEqual({ provider: 'MICROSOFT' });
      expect(args.create.provider).toBe('MICROSOFT');
      expect(args.create.scopes).toEqual([]);
    });

    it('should store token in format "iv:ciphertextAuthTag" (hex)', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await storeToken(TEST_TOKEN);

      const blob = mockUpsert.mock.calls[0][0].create.encrypted_token_blob;
      expect(blob).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
      const [iv, ciphertext] = blob.split(':');
      expect(iv.length).toBe(24); // 12 bytes = 24 hex chars
      expect(ciphertext.length).toBeGreaterThan(32); // at least authTag (32 hex chars)
    });
  });

  describe('getToken', () => {
    it('should return null when no token is stored', async () => {
      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue(null);

      const result = await getToken();

      expect(prisma.oAuthToken.findUnique).toHaveBeenCalledWith({
        where: { provider: 'MICROSOFT' },
      });
      expect(result).toBeNull();
    });

    it('should decrypt and return stored token', async () => {
      // Build a real encrypted blob matching the production format
      const key = Buffer.from(ENCRYPTION_KEY, 'hex');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let enc = cipher.update(TEST_TOKEN, 'utf8', 'hex');
      enc += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const blob = `${iv.toString('hex')}:${enc}${authTag.toString('hex')}`;

      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue({
        provider: 'MICROSOFT',
        encrypted_token_blob: blob,
      });

      const result = await getToken();

      expect(result).toBe(TEST_TOKEN);
    });

    it('should round-trip: storeToken then getToken returns original', async () => {
      let storedBlob = '';
      (prisma.oAuthToken.upsert as any) = vi.fn().mockImplementation((args: any) => {
        storedBlob = args.create.encrypted_token_blob;
        return Promise.resolve({});
      });

      await storeToken(TEST_TOKEN);

      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue({
        provider: 'MICROSOFT',
        encrypted_token_blob: storedBlob,
      });

      const result = await getToken();

      expect(result).toBe(TEST_TOKEN);
    });
  });

  describe('storeTokenForProvider', () => {
    it('should upsert with MICROSOFT provider when provider=MICROSOFT', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await storeTokenForProvider('MICROSOFT', TEST_TOKEN);

      const args = mockUpsert.mock.calls[0][0];
      expect(args.where).toEqual({ provider: 'MICROSOFT' });
      expect(args.create.provider).toBe('MICROSOFT');
    });

    it('should upsert with GOOGLE provider when provider=GOOGLE', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await storeTokenForProvider('GOOGLE', TEST_TOKEN);

      const args = mockUpsert.mock.calls[0][0];
      expect(args.where).toEqual({ provider: 'GOOGLE' });
      expect(args.create.provider).toBe('GOOGLE');
    });

    it('should encrypt the blob before storing', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await storeTokenForProvider('GOOGLE', TEST_TOKEN);

      const blob = mockUpsert.mock.calls[0][0].create.encrypted_token_blob;
      expect(blob).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
      expect(blob).not.toContain(TEST_TOKEN);
    });
  });

  describe('getTokenForProvider', () => {
    it('should return null when no token stored for provider', async () => {
      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue(null);

      const result = await getTokenForProvider('GOOGLE');

      expect(prisma.oAuthToken.findUnique).toHaveBeenCalledWith({
        where: { provider: 'GOOGLE' },
      });
      expect(result).toBeNull();
    });

    it('should decrypt and return stored token for GOOGLE', async () => {
      const key = Buffer.from(ENCRYPTION_KEY, 'hex');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let enc = cipher.update(TEST_TOKEN, 'utf8', 'hex');
      enc += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const blob = `${iv.toString('hex')}:${enc}${authTag.toString('hex')}`;

      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue({
        provider: 'GOOGLE',
        encrypted_token_blob: blob,
      });

      const result = await getTokenForProvider('GOOGLE');

      expect(result).toBe(TEST_TOKEN);
    });

    it('should query with the given provider enum value', async () => {
      (prisma.oAuthToken.findUnique as any) = vi.fn().mockResolvedValue(null);

      await getTokenForProvider('MICROSOFT');

      expect(prisma.oAuthToken.findUnique).toHaveBeenCalledWith({
        where: { provider: 'MICROSOFT' },
      });
    });
  });

  describe('refreshToken', () => {
    it('should POST to Microsoft OAuth2 token endpoint', async () => {
      const newAccessToken = 'new_access_token_xyz';
      const refreshTokenValue = 'refresh_token_abc';

      (axios.post as any) = vi.fn().mockResolvedValue({
        data: { access_token: newAccessToken, refresh_token: refreshTokenValue },
      });
      (prisma.oAuthToken.upsert as any) = vi.fn().mockResolvedValue({});

      const result = await refreshToken(refreshTokenValue, 'client-id', 'client-secret');

      expect(axios.post).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: refreshTokenValue,
          client_id: 'client-id',
          client_secret: 'client-secret',
        })
      );
      expect(result.access_token).toBe(newAccessToken);
      expect(result.refresh_token).toBe(refreshTokenValue);
    });

    it('should store new access token after refresh', async () => {
      const newAccessToken = 'new_access_token_xyz';
      const refreshTokenValue = 'refresh_token_abc';

      (axios.post as any) = vi.fn().mockResolvedValue({
        data: { access_token: newAccessToken, refresh_token: refreshTokenValue },
      });
      const mockUpsert = vi.fn().mockResolvedValue({});
      (prisma.oAuthToken.upsert as any) = mockUpsert;

      await refreshToken(refreshTokenValue, 'client-id', 'client-secret');

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0].where).toEqual({ provider: 'MICROSOFT' });
    });

    it('should propagate HTTP errors from Microsoft', async () => {
      (axios.post as any) = vi.fn().mockRejectedValue(new Error('OAuth server error'));

      await expect(
        refreshToken('bad_refresh_token', 'client-id', 'client-secret')
      ).rejects.toThrow('OAuth server error');
    });
  });
});
