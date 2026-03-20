import * as crypto from 'crypto';
import axios from 'axios';
import prisma from './prisma';

/**
 * Encrypts a token using AES-256-GCM
 * Returns format: "iv:ciphertextAuthTag" (all hex-encoded)
 */
function encryptToken(token: string, key: Buffer): string {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted}${authTag.toString('hex')}`;
}

/**
 * Decrypts a token encrypted with encryptToken
 * Expects format: "iv:ciphertextAuthTag"
 */
function decryptToken(encryptedBlob: string, key: Buffer): string {
  const [ivHex, ciphertextWithTag] = encryptedBlob.split(':');

  if (!ivHex || !ciphertextWithTag) {
    throw new Error('Invalid encrypted blob format');
  }

  const iv = Buffer.from(ivHex, 'hex');

  // Last 32 hex chars = 16 bytes = 128-bit auth tag
  const authTagHex = ciphertextWithTag.slice(-32);
  const ciphertextHex = ciphertextWithTag.slice(0, -32);

  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Get encryption key from OAUTH_ENC_KEY environment variable
 * Expected format: 64-char hex string (32 bytes)
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.OAUTH_ENC_KEY;
  if (!keyHex) {
    throw new Error('OAUTH_ENC_KEY environment variable not set');
  }

  if (keyHex.length !== 64) {
    throw new Error('OAUTH_ENC_KEY must be 64 hex characters (32 bytes)');
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Store an encrypted token blob in the database for the given provider.
 */
export async function storeTokenForProvider(
  provider: 'MICROSOFT' | 'GOOGLE',
  tokenBlob: string
): Promise<void> {
  const key = getEncryptionKey();
  const encrypted_token_blob = encryptToken(tokenBlob, key);

  await prisma.oAuthToken.upsert({
    where: { provider },
    update: { encrypted_token_blob },
    create: {
      provider,
      encrypted_token_blob,
      scopes: [],
    },
  });
}

/**
 * Retrieve and decrypt the stored token blob for the given provider.
 * Returns null if no token is stored.
 */
export async function getTokenForProvider(
  provider: 'MICROSOFT' | 'GOOGLE'
): Promise<string | null> {
  const record = await prisma.oAuthToken.findUnique({
    where: { provider },
  });

  if (!record) {
    return null;
  }

  const key = getEncryptionKey();
  return decryptToken(record.encrypted_token_blob, key);
}

/**
 * Store the Microsoft OAuth token encrypted in the database.
 * Single-tenant app: always upserts the MICROSOFT provider record.
 */
export async function storeToken(accessToken: string): Promise<void> {
  return storeTokenForProvider('MICROSOFT', accessToken);
}

/**
 * Retrieve and decrypt the Microsoft OAuth token from the database.
 * Returns null if no token is stored.
 */
export async function getToken(): Promise<string | null> {
  return getTokenForProvider('MICROSOFT');
}

/**
 * Refresh the Microsoft OAuth token using Microsoft's OAuth2 endpoint.
 * Stores the new access token and returns both tokens.
 */
export async function refreshToken(
  refreshTokenValue: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; refresh_token: string }> {
  const response = await axios.post(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
      client_id: clientId,
      client_secret: clientSecret,
    }
  );

  const { access_token, refresh_token } = response.data;

  await storeToken(access_token);

  return { access_token, refresh_token };
}
