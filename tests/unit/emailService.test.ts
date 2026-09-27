import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSecureToken,
  buildVerificationUrl,
  buildPasswordResetUrl,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sentEmailsLog,
  PASSWORD_RESET_EXPIRY_MS,
} from '../../src/services/emailService';
import { env } from '../../src/config/env';

describe('Email Notification Service (src/services/emailService.ts)', () => {
  beforeEach(() => {
    sentEmailsLog.length = 0;
  });

  describe('Token & URL Generation', () => {
    it('generates a 64-character (32-byte) hex cryptographically secure token', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();

      expect(token1).toHaveLength(64);
      expect(token2).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);
      expect(token1).not.toBe(token2);
    });

    it('builds verification URL correctly matching configured FRONTEND_URL', () => {
      const token = 'sample-verification-token-123';
      const url = buildVerificationUrl(token);

      expect(url).toBe(`${env.FRONTEND_URL}/verify-email?token=${token}`);
    });

    it('builds password reset URL correctly matching configured FRONTEND_URL', () => {
      const token = 'sample-reset-token-456';
      const url = buildPasswordResetUrl(token);

      expect(url).toBe(`${env.FRONTEND_URL}/reset-password?token=${token}`);
    });

    it('defines password reset expiry as 1 hour (3,600,000 ms)', () => {
      expect(PASSWORD_RESET_EXPIRY_MS).toBe(60 * 60 * 1000);
    });
  });

  describe('Verification Email Construction & Dispatch', () => {
    it('constructs and logs verification email with proper recipient, URL, and greeting', async () => {
      const recipient = 'photographer@example.com';
      const token = generateSecureToken();
      const name = 'Aarav';

      const success = await sendVerificationEmail(recipient, token, name);
      expect(success).toBe(true);

      expect(sentEmailsLog).toHaveLength(1);
      const sent = sentEmailsLog[0];
      expect(sent).toBeDefined();
      expect(sent?.to).toBe(recipient);
      expect(sent?.subject).toContain('Verify your PhotoMemories AI account');
      expect(sent?.html).toContain(`Hello ${name}`);
      expect(sent?.html).toContain(buildVerificationUrl(token));
      expect(sent?.text).toContain(buildVerificationUrl(token));
    });

    it('constructs generic greeting when name is omitted in verification email', async () => {
      const recipient = 'anonymous@example.com';
      const token = generateSecureToken();

      const success = await sendVerificationEmail(recipient, token);
      expect(success).toBe(true);

      const sent = sentEmailsLog[0];
      expect(sent?.html).toContain('Hello,');
    });
  });

  describe('Password Reset Email Construction & Dispatch', () => {
    it('constructs and logs password reset email with reset link and 1-hour expiration warning', async () => {
      const recipient = 'user@example.com';
      const token = generateSecureToken();
      const name = 'Priya';

      const success = await sendPasswordResetEmail(recipient, token, name);
      expect(success).toBe(true);

      expect(sentEmailsLog).toHaveLength(1);
      const sent = sentEmailsLog[0];
      expect(sent).toBeDefined();
      expect(sent?.to).toBe(recipient);
      expect(sent?.subject).toContain('Reset your PhotoMemories AI password');
      expect(sent?.html).toContain(`Hello ${name}`);
      expect(sent?.html).toContain(buildPasswordResetUrl(token));
      expect(sent?.html).toContain('expire in 1 hour');
      expect(sent?.text).toContain('expires in 1 hour');
    });
  });
});
