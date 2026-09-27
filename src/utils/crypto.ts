import crypto from 'node:crypto';
import { env } from '../config/env';

// Helper to ensure a 32-byte Buffer for AES-256-GCM
function getEncryptionKeyBuffer(keyString: string): Buffer {
  // If 64 hex characters (32 bytes), parse directly as hex
  if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
    return Buffer.from(keyString, 'hex');
  }
  // Otherwise, derive 32-byte key via SHA-256
  return crypto.createHash('sha256').update(keyString).digest();
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * Format: iv:authTag:encrypted (hex-encoded)
 * Authoritative Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 23-24)
 */
export function encryptData(data: string, customKey?: string): string {
  const key = getEncryptionKeyBuffer(customKey || env.ENCRYPTION_KEY);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 * Format: iv:authTag:encrypted (hex-encoded)
 * Authoritative Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 23-24)
 */
export function decryptData(encryptedString: string, customKey?: string): string {
  const parts = encryptedString.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || parts[2] === undefined) {
    throw new Error('Invalid encrypted data format. Expected iv:authTag:ciphertext');
  }

  const key = getEncryptionKeyBuffer(customKey || env.ENCRYPTION_KEY);
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
