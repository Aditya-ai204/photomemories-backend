import { Response, CookieOptions } from 'express';
import { env } from '../config/env';

/**
 * Authoritative Cookie Transport Utilities
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 24, 30)
 * - "Stored in httpOnly cookie (backend sets on login)"
 * - "Token sent via httpOnly cookie (not header)"
 * - 24-hour expiry for access tokens
 * - 7-day expiry for refresh tokens
 */

export const ACCESS_TOKEN_COOKIE_NAME = 'access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

// 24 hours in milliseconds (PRD Page 24)
export const ACCESS_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// 7 days in milliseconds (PRD Page 28: JWT_REFRESH_EXPIRY=7d)
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthCookieConfigOptions {
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  domain?: string;
}

/**
 * Returns environment-aware base cookie options.
 * In production cross-site hosting (Vercel frontend -> Railway/Render backend),
 * cookies require secure: true and sameSite: 'none'.
 * In development (localhost), sameSite: 'lax' and secure: false are used.
 */
export function getBaseCookieOptions(overrides?: AuthCookieConfigOptions): CookieOptions {
  const isProduction = env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: overrides?.secure !== undefined ? overrides.secure : isProduction,
    sameSite: overrides?.sameSite !== undefined ? overrides.sameSite : (isProduction ? 'none' : 'lax'),
    path: '/',
    ...(overrides?.domain ? { domain: overrides.domain } : {}),
  };
}

/**
 * Sets secure httpOnly authentication cookies on the response.
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken?: string,
  options?: AuthCookieConfigOptions
): void {
  const baseOptions = getBaseCookieOptions(options);

  // Set Access Token Cookie (24 hours)
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    ...baseOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });

  // Set Refresh Token Cookie (7 days) if provided
  if (refreshToken) {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      ...baseOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
  }
}

/**
 * Clears authentication cookies upon logout.
 */
export function clearAuthCookies(res: Response, options?: AuthCookieConfigOptions): void {
  const baseOptions = getBaseCookieOptions(options);

  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, baseOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, baseOptions);
  // Also clear legacy/fallback token cookie name if present
  res.clearCookie('token', baseOptions);
}
