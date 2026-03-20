/**
 * Manual validation script for oauthService
 * Run with: NODE_ENV=test OAUTH_ENC_KEY=0000000000000000000000000000000000000000000000000000000000000000 ts-node src/lib/__tests__/validate-oauth.ts
 */

import * as crypto from 'crypto';

// Simplified copy of encryption functions for validation
function encryptToken(token: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted}${authTag.toString('hex')}`;
}

function decryptToken(encryptedBlob: string, key: Buffer): string {
  const [ivHex, ciphertextWithTag] = encryptedBlob.split(':');
  if (!ivHex || !ciphertextWithTag) {
    throw new Error('Invalid encrypted blob format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTagHex = ciphertextWithTag.slice(-32);
  const ciphertextHex = ciphertextWithTag.slice(0, -32);

  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function validate() {
  const TEST_TOKEN = 'test_access_token_123456789';
  const ENCRYPTION_KEY = '0'.repeat(64); // 32 bytes in hex
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');

  console.log('=== OAuth Service Validation ===\n');

  try {
    // Test 1: Encrypt/Decrypt round-trip
    console.log('✓ Test 1: Round-trip encryption/decryption');
    const encrypted = encryptToken(TEST_TOKEN, key);
    console.log(`  Encrypted format: ${encrypted.substring(0, 40)}...`);

    // Validate format
    if (!encrypted.includes(':')) {
      throw new Error('Encrypted format invalid: missing ":"');
    }
    console.log('  Format valid: "iv:ciphertext"');

    const decrypted = decryptToken(encrypted, key);
    if (decrypted !== TEST_TOKEN) {
      throw new Error(`Decryption failed: got "${decrypted}", expected "${TEST_TOKEN}"`);
    }
    console.log(`  Decrypted token: "${decrypted}"`);
    console.log('  ✓ PASS\n');

    // Test 2: Validate encryption format
    console.log('✓ Test 2: Encryption format validation');
    const [iv, ciphertext] = encrypted.split(':');
    console.log(`  IV length: ${iv.length} hex chars (${iv.length / 2} bytes)`);
    console.log(`  Ciphertext+Tag length: ${ciphertext.length} hex chars`);
    if (iv.length !== 24) { // 12 bytes = 24 hex chars
      throw new Error(`IV length invalid: ${iv.length} != 24`);
    }
    console.log('  ✓ PASS\n');

    // Test 3: Validate different tokens produce different ciphertexts
    console.log('✓ Test 3: Different tokens -> different ciphertexts');
    const encrypted2 = encryptToken(TEST_TOKEN, key);
    if (encrypted === encrypted2) {
      throw new Error('Same token produced same ciphertext (IV should be random)');
    }
    console.log('  ✓ PASS\n');

    // Test 4: Wrong key fails decryption
    console.log('✓ Test 4: Wrong key fails decryption');
    const wrongKey = Buffer.from('1'.repeat(64), 'hex');
    try {
      decryptToken(encrypted, wrongKey);
      throw new Error('Decryption should have failed with wrong key');
    } catch (e) {
      if (e instanceof Error && e.message.includes('Decryption should have failed')) {
        throw e;
      }
      console.log('  Expected error with wrong key: OK');
      console.log('  ✓ PASS\n');
    }

    console.log('=== All validation tests passed! ===');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ FAILED:', error);
    process.exit(1);
  }
}

validate();
