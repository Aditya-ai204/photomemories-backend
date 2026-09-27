import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../src/config/env';

describe('Environment Configuration Validation', () => {
  const validMockEnv = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    JWT_SECRET: 'super_secret_jwt_key_at_least_32_chars_long',
    JWT_EXPIRY: '24h',
    JWT_REFRESH_SECRET: 'super_secret_refresh_key_at_least_32_chars_long',
    JWT_REFRESH_EXPIRY: '7d',
    CLOUDINARY_CLOUD_NAME: 'test_cloud',
    CLOUDINARY_API_KEY: 'test_key',
    CLOUDINARY_API_SECRET: 'test_secret',
    EMAIL_USER: 'test@example.com',
    EMAIL_PASSWORD: 'test_password',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    RAZORPAY_KEY_ID: 'rzp_test_123',
    RAZORPAY_KEY_SECRET: 'rzp_secret_123',
    FRONTEND_URL: 'http://localhost:3000',
    ADMIN_EMAIL: 'admin@photomemories.ai',
    NODE_ENV: 'test',
    PORT: 3001,
  };

  it('successfully parses and validates a complete environment configuration', () => {
    const config = parseEnv(validMockEnv);
    expect(config.DATABASE_URL).toBe(validMockEnv.DATABASE_URL);
    expect(config.PORT).toBe(3001);
    expect(config.ADMIN_EMAIL).toBe('admin@photomemories.ai');
    expect(config.NODE_ENV).toBe('test');
  });

  it('throws an informative error when mandatory variables are missing', () => {
    const incompleteEnv = { ...validMockEnv };
    delete (incompleteEnv as Record<string, unknown>)['DATABASE_URL'];
    delete (incompleteEnv as Record<string, unknown>)['RAZORPAY_KEY_ID'];

    expect(() => parseEnv(incompleteEnv)).toThrowError(/DATABASE_URL/i);
  });

  it('fails validation when JWT_SECRET is too short', () => {
    const invalidEnv = { ...validMockEnv, JWT_SECRET: 'short' };
    expect(() => parseEnv(invalidEnv)).toThrowError(/JWT_SECRET must be at least 16 characters/);
  });

  it('fails validation when ADMIN_EMAIL is not a valid email', () => {
    const invalidEnv = { ...validMockEnv, ADMIN_EMAIL: 'not-an-email' };
    expect(() => parseEnv(invalidEnv)).toThrowError(/ADMIN_EMAIL must be a valid email/);
  });
});
