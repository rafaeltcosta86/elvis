import * as crypto from 'crypto';
import prisma from './prisma';

/**
 * Decrypts a token encrypted with AES-256-GCM
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
 * Retrieve and decrypt the Microsoft OAuth token from the database.
 * Returns null if no token is stored.
 */
export async function getToken(): Promise<string | null> {
  const record = await prisma.oAuthToken.findUnique({
    where: { provider: 'MICROSOFT' },
  });

  if (!record) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    return decryptToken(record.encrypted_token_blob, key);
  } catch (error) {
    console.error('Error decrypting Microsoft token:', error);
    return null;
  }
}
