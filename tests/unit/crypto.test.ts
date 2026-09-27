import { describe, it, expect } from 'vitest';
import { encryptData, decryptData } from '../../src/utils/crypto';

describe('AES-256-GCM Cryptographic Utility', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const plaintext = 'client@example.com';

  it('encrypts plaintext into the PRD-mandated iv:authTag:ciphertext hex format', () => {
    const encrypted = encryptData(plaintext, testKey);
    const parts = encrypted.split(':');

    expect(parts.length).toBe(3);
    expect(parts[0]).toHaveLength(32); // 16 bytes IV = 32 hex chars
    expect(parts[1]).toHaveLength(32); // 16 bytes AuthTag = 32 hex chars
    expect(parts[2]?.length).toBeGreaterThan(0);
  });

  it('decrypts encrypted data back to original plaintext', () => {
    const encrypted = encryptData(plaintext, testKey);
    const decrypted = decryptData(encrypted, testKey);

    expect(decrypted).toBe(plaintext);
  });

  it('handles empty string plaintext properly', () => {
    const emptyPlaintext = '';
    const encrypted = encryptData(emptyPlaintext, testKey);
    const decrypted = decryptData(encrypted, testKey);

    expect(decrypted).toBe(emptyPlaintext);
  });

  it('throws an authentication error when ciphertext is tampered with', () => {
    const encrypted = encryptData(plaintext, testKey);
    const parts = encrypted.split(':');

    // Alter ciphertext
    const tamperedCiphertext = parts[2]!.slice(0, -2) + 'ff';
    const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

    expect(() => decryptData(tamperedPayload, testKey)).toThrow();
  });

  it('throws an authentication error when authTag is tampered with', () => {
    const encrypted = encryptData(plaintext, testKey);
    const parts = encrypted.split(':');

    // Alter authTag
    const tamperedAuthTag = '00000000000000000000000000000000';
    const tamperedPayload = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

    expect(() => decryptData(tamperedPayload, testKey)).toThrow();
  });

  it('rejects malformed encrypted strings', () => {
    expect(() => decryptData('invalid-format', testKey)).toThrow(/Invalid encrypted data format/);
    expect(() => decryptData('iv:authtag', testKey)).toThrow(/Invalid encrypted data format/);
  });
});
