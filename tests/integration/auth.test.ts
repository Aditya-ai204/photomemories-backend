import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { hashPassword } from '../../src/utils/password';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';
import { sentEmailsLog } from '../../src/services/emailService';

vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

describe('Authentication Endpoints Integration (/api/auth)', () => {
  const queryMock = vi.mocked(db.query);

  beforeEach(() => {
    vi.clearAllMocks();
    sentEmailsLog.length = 0;
  });

  describe('POST /api/auth/signup', () => {
    const signupData = {
      email: 'photographer@example.com',
      password: 'StrongPassword123!',
      name: 'John Doe',
      company_name: 'John Photography',
      phone: '9876543210',
    };

    it('registers a new photographer successfully and returns 201 with PRD-specified payload', async () => {
      // 1. Check existing email -> 0 rows
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      // 2. Subdomain availability checks for 'john-photography'
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // users check
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // subdomains check

      // 3. Insert user query
      const mockCreatedUser = {
        id: 101,
        email: 'photographer@example.com',
        name: 'John Doe',
        role: 'photographer',
        company_name: 'John Photography',
        phone: '9876543210',
        subdomain: 'john-photography',
        email_verified: false,
        created_at: new Date(),
      };
      queryMock.mockResolvedValueOnce({ rows: [mockCreatedUser] } as never);

      // 4. Subdomain assignment queries (availability + insert + update)
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const res = await request(app)
        .post('/api/auth/signup')
        .send(signupData);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({
        id: 101,
        email: 'photographer@example.com',
        name: 'John Doe',
        role: 'photographer',
        company_name: 'John Photography',
        subdomain: 'john-photography',
        email_verified: false,
      });
      expect(res.body.token).toBeDefined();
      expect(res.body.subdomain).toBe('john-photography.photomemories.ai');

      // Check httpOnly cookie is set
      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.some((c) => c.includes(ACCESS_TOKEN_COOKIE_NAME))).toBe(true);

      // Verify email was logged to test dispatch
      expect(sentEmailsLog).toHaveLength(1);
      expect(sentEmailsLog[0]?.to).toBe(signupData.email);
    });

    it('rejects registration when email is already in use with 409 EMAIL_EXISTS', async () => {
      // Existing user found
      queryMock.mockResolvedValueOnce({ rows: [{ id: 99 }] } as never);

      const res = await request(app)
        .post('/api/auth/signup')
        .send(signupData);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        success: false,
        error: 'An account with this email already exists',
        code: 'EMAIL_EXISTS',
      });
    });

    it('rejects registration when password is shorter than 8 characters', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...signupData, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects registration with invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...signupData, email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    it('authenticates user successfully with valid credentials and returns 200 with token and cookies', async () => {
      const plainPassword = 'CorrectPassword123!';
      const hash = await hashPassword(plainPassword);

      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        password_hash: hash,
        name: 'Aarav',
        role: 'photographer',
        company_name: 'Aarav Studio',
        phone: '1234567890',
        subdomain: 'aarav-studio',
        is_active: true,
        email_verified: true,
      };

      // 1. User lookup
      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);
      // 2. Update last_login
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@example.com',
          password: plainPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({
        id: 42,
        email: 'photographer@example.com',
        name: 'Aarav',
        role: 'photographer',
      });
      expect(res.body.token).toBeDefined();

      // Check httpOnly cookies
      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.some((c) => c.includes(ACCESS_TOKEN_COOKIE_NAME))).toBe(true);

      // Verify last_login update query
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET last_login'),
        [42]
      );
    });

    it('rejects login with 401 INVALID_CREDENTIALS when password is incorrect', async () => {
      const hash = await hashPassword('CorrectPassword123!');
      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        password_hash: hash,
        is_active: true,
      };

      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@example.com',
          password: 'WrongPassword456!',
        });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('rejects login with 401 INVALID_CREDENTIALS when email does not exist', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login with 403 ACCOUNT_DEACTIVATED when account is inactive', async () => {
      const hash = await hashPassword('CorrectPassword123!');
      const mockUser = {
        id: 42,
        email: 'deactivated@example.com',
        password_hash: hash,
        is_active: false,
      };

      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'deactivated@example.com',
          password: 'CorrectPassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears auth cookies and returns 200 when authenticated', async () => {
      const token = signAccessToken({
        userId: 42,
        email: 'photographer@example.com',
        role: 'photographer',
      });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.some((c) => c.includes(`${ACCESS_TOKEN_COOKIE_NAME}=;`))).toBe(true);
    });

    it('rejects logout with 401 UNAUTHORIZED when no token is provided', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('verifies user email successfully and returns 200 with { success: true }', async () => {
      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        email_verified: false,
      };

      // 1. Lookup user by verification token
      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);
      // 2. Update user query
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'valid-verification-token-123' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      // Verify database update
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SET email_verified = true, verification_token = NULL'),
        [42]
      );
    });

    it('rejects with 400 INVALID_TOKEN when verification token is unknown or already used', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'unknown-token' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Invalid or expired verification token',
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('generates reset token, sends email, and returns 200 generic success for existing user', async () => {
      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        name: 'Aarav',
        is_active: true,
      };

      // 1. Lookup user
      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);
      // 2. Update reset token
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'photographer@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      // Verify reset token was updated
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SET password_reset_token = $1, password_reset_expires = $2'),
        expect.arrayContaining([expect.any(String), expect.any(Date), 42])
      );

      // Verify email was logged
      expect(sentEmailsLog).toHaveLength(1);
      expect(sentEmailsLog[0]?.to).toBe('photographer@example.com');
      expect(sentEmailsLog[0]?.subject).toContain('Reset your PhotoMemories AI password');
    });

    it('returns generic success even if email does not exist to prevent account enumeration', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(sentEmailsLog).toHaveLength(0);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('resets password successfully and returns 200 with { success: true }', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000); // 30 mins in future
      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        password_reset_expires: futureDate,
      };

      // 1. Lookup user by reset token
      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);
      // 2. Update password query
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'valid-reset-token-xyz',
          password: 'NewStrongPassword456!',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      // Verify password was updated and token cleared
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SET password_hash = $1, password_reset_token = NULL'),
        expect.arrayContaining([expect.stringMatching(/^\$2/), 42])
      );
    });

    it('rejects reset with 400 INVALID_TOKEN when reset token is not found', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: 'NewStrongPassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Invalid or expired password reset token',
        code: 'INVALID_TOKEN',
      });
    });

    it('rejects reset with 400 TOKEN_EXPIRED when reset token has expired', async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 mins ago
      const mockUser = {
        id: 42,
        email: 'photographer@example.com',
        password_reset_expires: pastDate,
      };

      queryMock.mockResolvedValueOnce({ rows: [mockUser] } as never);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'expired-token',
          password: 'NewStrongPassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Password reset token has expired',
        code: 'TOKEN_EXPIRED',
      });
    });

    it('rejects reset when new password is too short', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'some-token',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
