import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword, BCRYPT_SALT_ROUNDS } from '../../src/utils/password';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../src/utils/jwt';

describe('Password Utility (bcrypt)', () => {
  const plainPassword = 'SuperSecurePassword123!';

  it('verifies salt cost factor is set to 10 per PRD page 23', () => {
    expect(BCRYPT_SALT_ROUNDS).toBe(10);
  });

  it('hashes password successfully and generated hash is not equal to plaintext', async () => {
    const hash = await hashPassword(plainPassword);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe(plainPassword);
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifies correct password successfully against the stored hash', async () => {
    const hash = await hashPassword(plainPassword);
    const isValid = await comparePassword(plainPassword, hash);

    expect(isValid).toBe(true);
  });

  it('rejects incorrect password when compared against the stored hash', async () => {
    const hash = await hashPassword(plainPassword);
    const isValid = await comparePassword('WrongPassword456!', hash);

    expect(isValid).toBe(false);
  });

  it('produces different hashes for repeated hashing while both remain valid', async () => {
    const hash1 = await hashPassword(plainPassword);
    const hash2 = await hashPassword(plainPassword);

    expect(hash1).not.toBe(hash2);
    expect(await comparePassword(plainPassword, hash1)).toBe(true);
    expect(await comparePassword(plainPassword, hash2)).toBe(true);
  });

  it('handles empty and invalid input appropriately according to utility contract', async () => {
    // hashPassword rejects empty or whitespace-only password
    await expect(hashPassword('')).rejects.toThrow('Password must be a non-empty string');
    await expect(hashPassword('   ')).rejects.toThrow('Password must be a non-empty string');

    // comparePassword safely returns false without throwing on empty or invalid inputs
    const validHash = await hashPassword(plainPassword);
    expect(await comparePassword('', validHash)).toBe(false);
    expect(await comparePassword('   ', validHash)).toBe(false);
    expect(await comparePassword(plainPassword, '')).toBe(false);
    expect(await comparePassword(plainPassword, 'invalid-hash-string')).toBe(false);
  });
});

describe('JWT Utility (jsonwebtoken)', () => {
  const sampleAccessPayload: AccessTokenPayload = {
    userId: 42,
    email: 'photographer@example.com',
    role: 'photographer',
  };

  const sampleRefreshPayload: RefreshTokenPayload = {
    userId: 42,
  };

  describe('Access Token Lifecycle', () => {
    it('generates and verifies access token successfully with payload intact', () => {
      const token = signAccessToken(sampleAccessPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe(sampleAccessPayload.userId);
      expect(decoded.email).toBe(sampleAccessPayload.email);
      expect(decoded.role).toBe(sampleAccessPayload.role);
      expect(decoded.tokenType).toBe('access');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('sets access token expiration approximately 24 hours in the future', () => {
      const token = signAccessToken(sampleAccessPayload);
      const decoded = verifyAccessToken(token);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const diffSeconds = (decoded.exp ?? 0) - nowSeconds;

      // 24 hours = 86400 seconds; allow ±10 seconds drift
      expect(diffSeconds).toBeGreaterThan(86390);
      expect(diffSeconds).toBeLessThanOrEqual(86410);
    });
  });

  describe('Refresh Token Lifecycle', () => {
    it('generates and verifies refresh token successfully with payload intact', () => {
      const token = signRefreshToken(sampleRefreshPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe(sampleRefreshPayload.userId);
      expect(decoded.tokenType).toBe('refresh');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('sets refresh token expiration approximately 7 days in the future', () => {
      const token = signRefreshToken(sampleRefreshPayload);
      const decoded = verifyRefreshToken(token);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const diffSeconds = (decoded.exp ?? 0) - nowSeconds;

      // 7 days = 604800 seconds; allow ±10 seconds drift
      expect(diffSeconds).toBeGreaterThan(604790);
      expect(diffSeconds).toBeLessThanOrEqual(604810);
    });
  });

  describe('Validation & Security Rejections', () => {
    it('rejects an invalid token string', () => {
      expect(() => verifyAccessToken('not.a.valid.jwt')).toThrow();
      expect(() => verifyRefreshToken('')).toThrow('Invalid token provided');
    });

    it('rejects a tampered token signature', () => {
      const validToken = signAccessToken(sampleAccessPayload);
      const parts = validToken.split('.');
      // Tamper payload part
      const tamperedToken = `${parts[0]}.${parts[1]}xyz.${parts[2]}`;

      expect(() => verifyAccessToken(tamperedToken)).toThrow();
    });

    it('rejects access token when verified with wrong secret', () => {
      const token = signAccessToken(sampleAccessPayload, 'custom_secret_key_1234567890');
      expect(() => verifyAccessToken(token, 'different_secret_key_1234567890')).toThrow();
    });

    it('rejects refresh token when presented to verifyAccessToken', () => {
      const refreshToken = signRefreshToken(sampleRefreshPayload);
      // Fails signature check (different secrets) or tokenType check
      expect(() => verifyAccessToken(refreshToken)).toThrow();
    });

    it('rejects access token when presented to verifyRefreshToken', () => {
      const accessToken = signAccessToken(sampleAccessPayload);
      // Fails signature check (different secrets) or tokenType check
      expect(() => verifyRefreshToken(accessToken)).toThrow();
    });

    it('rejects token if tokenType claim does not match expected type even if signed with same secret', () => {
      const testSecret = 'shared_test_secret_for_type_check_32chars';
      // Sign access token with testSecret
      const accessToken = signAccessToken(sampleAccessPayload, testSecret);

      // Attempt verifying as refresh token using the same secret
      expect(() => verifyRefreshToken(accessToken, testSecret)).toThrow(
        'Invalid token type. Expected refresh token'
      );
    });

    it('rejects an expired token', () => {
      // Sign token that expires immediately (-1 second)
      const expiredToken = signAccessToken(
        sampleAccessPayload,
        undefined,
        '-1s' as unknown as number
      );

      expect(() => verifyAccessToken(expiredToken)).toThrow(/jwt expired/i);
    });
  });
});
