import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import {
  setAuthCookies,
  clearAuthCookies,
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
  getBaseCookieOptions,
} from '../../src/utils/cookies';
import { requireAuth, requireRole } from '../../src/middleware/auth';
import {
  signAccessToken,
  signRefreshToken,
  AccessTokenPayload,
} from '../../src/utils/jwt';
import { AppError } from '../../src/types';

describe('Auth Middleware & Cookie Transport', () => {
  const validUserPayload: AccessTokenPayload = {
    userId: 101,
    email: 'photographer@example.com',
    role: 'photographer',
  };

  describe('Cookie Transport Utility (src/utils/cookies.ts)', () => {
    it('generates base cookie options with httpOnly=true, path=/', () => {
      const options = getBaseCookieOptions();
      expect(options.httpOnly).toBe(true);
      expect(options.path).toBe('/');
      expect(options.sameSite).toBeDefined();
    });

    it('sets access token and refresh token cookies correctly with proper attributes', () => {
      const cookieMock = vi.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      const accessToken = 'sample.access.jwt';
      const refreshToken = 'sample.refresh.jwt';

      setAuthCookies(mockRes, accessToken, refreshToken);

      expect(cookieMock).toHaveBeenCalledTimes(2);

      // 1. Access Token Cookie
      expect(cookieMock).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE_NAME,
        accessToken,
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          maxAge: ACCESS_TOKEN_MAX_AGE_MS,
        })
      );

      // 2. Refresh Token Cookie
      expect(cookieMock).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        refreshToken,
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          maxAge: REFRESH_TOKEN_MAX_AGE_MS,
        })
      );
    });

    it('sets only access token cookie when refresh token is omitted', () => {
      const cookieMock = vi.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      setAuthCookies(mockRes, 'single.access.jwt');

      expect(cookieMock).toHaveBeenCalledTimes(1);
      expect(cookieMock).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE_NAME,
        'single.access.jwt',
        expect.objectContaining({
          maxAge: ACCESS_TOKEN_MAX_AGE_MS,
        })
      );
    });

    it('respects secure and sameSite override options', () => {
      const cookieMock = vi.fn();
      const mockRes = {
        cookie: cookieMock,
      } as unknown as Response;

      setAuthCookies(mockRes, 'token.jwt', undefined, {
        secure: true,
        sameSite: 'none',
        domain: '.photomemories.ai',
      });

      expect(cookieMock).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE_NAME,
        'token.jwt',
        expect.objectContaining({
          secure: true,
          sameSite: 'none',
          domain: '.photomemories.ai',
        })
      );
    });

    it('clears access, refresh, and fallback token cookies on clearAuthCookies', () => {
      const clearCookieMock = vi.fn();
      const mockRes = {
        clearCookie: clearCookieMock,
      } as unknown as Response;

      clearAuthCookies(mockRes);

      expect(clearCookieMock).toHaveBeenCalledTimes(3);
      expect(clearCookieMock).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE_NAME,
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
      expect(clearCookieMock).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
      expect(clearCookieMock).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
    });
  });

  describe('requireAuth Middleware', () => {
    it('authenticates successfully from httpOnly cookie and attaches payload to req.user', () => {
      const token = signAccessToken(validUserPayload);
      const mockReq = {
        cookies: {
          [ACCESS_TOKEN_COOKIE_NAME]: token,
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user?.userId).toBe(validUserPayload.userId);
      expect(mockReq.user?.email).toBe(validUserPayload.email);
      expect(mockReq.user?.role).toBe(validUserPayload.role);
      expect(mockReq.user?.tokenType).toBe('access');
    });

    it('authenticates successfully from Authorization Bearer header fallback', () => {
      const token = signAccessToken(validUserPayload);
      const mockReq = {
        cookies: {},
        headers: {
          authorization: `Bearer ${token}`,
        },
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockReq.user?.userId).toBe(validUserPayload.userId);
    });

    it('authenticates successfully from fallback "token" cookie', () => {
      const token = signAccessToken(validUserPayload);
      const mockReq = {
        cookies: {
          token,
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockReq.user?.userId).toBe(validUserPayload.userId);
    });

    it('rejects with 401 UNAUTHORIZED when no token is present in cookie or header', () => {
      const mockReq = {
        cookies: {},
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.message).toContain('Missing access token');
    });

    it('rejects with 401 INVALID_TOKEN when token is malformed', () => {
      const mockReq = {
        cookies: {
          [ACCESS_TOKEN_COOKIE_NAME]: 'malformed.jwt.token',
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('INVALID_TOKEN');
    });

    it('rejects with 401 INVALID_TOKEN when token signature is invalid', () => {
      const token = signAccessToken(validUserPayload, 'different_signing_secret_32chars_long');
      const mockReq = {
        cookies: {
          [ACCESS_TOKEN_COOKIE_NAME]: token,
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('INVALID_TOKEN');
    });

    it('rejects with 401 TOKEN_EXPIRED when access token has expired', () => {
      const expiredToken = signAccessToken(validUserPayload, undefined, '-1s' as unknown as number);
      const mockReq = {
        cookies: {
          [ACCESS_TOKEN_COOKIE_NAME]: expiredToken,
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects with 401 INVALID_TOKEN when a refresh token is presented to requireAuth', () => {
      const refreshToken = signRefreshToken({ userId: 101 });
      const mockReq = {
        cookies: {
          [ACCESS_TOKEN_COOKIE_NAME]: refreshToken,
        },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      requireAuth(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('requireRole Middleware', () => {
    it('allows photographer to access photographer-authorized route', () => {
      const mockReq = {
        user: {
          userId: 101,
          email: 'photographer@example.com',
          role: 'photographer',
          tokenType: 'access',
        },
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      const middleware = requireRole('photographer');
      middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('allows admin to access admin-authorized route', () => {
      const mockReq = {
        user: {
          userId: 1,
          email: 'admin@photomemories.ai',
          role: 'admin',
          tokenType: 'access',
        },
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      const middleware = requireRole('admin');
      middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('allows both roles when multiple roles are authorized', () => {
      const mockPhotographerReq = {
        user: { userId: 101, email: 'p@example.com', role: 'photographer', tokenType: 'access' },
      } as unknown as Request;
      const mockAdminReq = {
        user: { userId: 1, email: 'a@photomemories.ai', role: 'admin', tokenType: 'access' },
      } as unknown as Request;

      const mockRes = {} as Response;
      const next1 = vi.fn();
      const next2 = vi.fn();

      const middleware = requireRole('photographer', 'admin');
      middleware(mockPhotographerReq, mockRes, next1);
      middleware(mockAdminReq, mockRes, next2);

      expect(next1).toHaveBeenCalledWith();
      expect(next2).toHaveBeenCalledWith();
    });

    it('rejects photographer from admin-only route with 403 FORBIDDEN', () => {
      const mockReq = {
        user: {
          userId: 101,
          email: 'photographer@example.com',
          role: 'photographer',
          tokenType: 'access',
        },
      } as unknown as Request;

      const mockRes = {} as Response;
      const next = vi.fn();

      const middleware = requireRole('admin');
      middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });

    it('rejects with 401 UNAUTHORIZED if req.user is missing when requireRole executes', () => {
      const mockReq = {} as unknown as Request;
      const mockRes = {} as Response;
      const next = vi.fn();

      const middleware = requireRole('photographer');
      middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      const call = next.mock.calls[0];
      expect(call).toBeDefined();
      const error = (call ? call[0] : undefined) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });
});
