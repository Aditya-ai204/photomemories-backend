import bcrypt from 'bcrypt';

/**
 * Authoritative Password Utility
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Page 23)
 * "const hash = await bcrypt.hash(password, 10);"
 */
export const BCRYPT_SALT_ROUNDS = 10;

/**
 * Hash a plaintext password using bcrypt with salt cost factor 10.
 * Never logs or exposes plaintext password.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 * Returns boolean indication of match. Never exposes inputs in errors.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
