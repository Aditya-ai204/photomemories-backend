import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Authoritative JWT Utility
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 24, 28)
 * - 24-hour expiry for access tokens
 * - 7-day expiry for refresh tokens
 * - Signed with separate secrets from environment configuration
 */

export type UserRole = 'photographer' | 'admin';

export interface AccessTokenPayload {
  userId: number;
  email: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  userId: number;
}

export interface DecodedAccessToken extends AccessTokenPayload {
  tokenType: 'access';
  iat?: number;
  exp?: number;
}

export interface DecodedRefreshToken extends RefreshTokenPayload {
  tokenType: 'refresh';
  iat?: number;
  exp?: number;
}

interface InternalAccessTokenPayload extends AccessTokenPayload {
  tokenType: 'access';
}

interface InternalRefreshTokenPayload extends RefreshTokenPayload {
  tokenType: 'refresh';
}

/**
 * Signs a 24-hour access token (default) using JWT_SECRET.
 */
export function signAccessToken(
  payload: AccessTokenPayload,
  customSecret?: string,
  customExpiresIn?: SignOptions['expiresIn']
): string {
  const secret = customSecret || env.JWT_SECRET;
  const expiresIn = customExpiresIn || (env.JWT_EXPIRY as SignOptions['expiresIn']);

  const tokenPayload: InternalAccessTokenPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    tokenType: 'access',
  };

  return jwt.sign(tokenPayload, secret, { expiresIn });
}

/**
 * Signs a 7-day refresh token (default) using JWT_REFRESH_SECRET.
 */
export function signRefreshToken(
  payload: RefreshTokenPayload,
  customSecret?: string,
  customExpiresIn?: SignOptions['expiresIn']
): string {
  const secret = customSecret || env.JWT_REFRESH_SECRET;
  const expiresIn = customExpiresIn || (env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn']);

  const tokenPayload: InternalRefreshTokenPayload = {
    userId: payload.userId,
    tokenType: 'refresh',
  };

  return jwt.sign(tokenPayload, secret, { expiresIn });
}

/**
 * Verifies an access token using JWT_SECRET and validates token type.
 */
export function verifyAccessToken(
  token: string,
  customSecret?: string
): DecodedAccessToken {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token provided');
  }

  const secret = customSecret || env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);

  if (typeof decoded === 'string' || !decoded) {
    throw new Error('Malformed token payload');
  }

  if (decoded['tokenType'] !== 'access') {
    throw new Error('Invalid token type. Expected access token');
  }

  return {
    userId: decoded['userId'],
    email: decoded['email'],
    role: decoded['role'],
    tokenType: 'access',
    iat: decoded['iat'],
    exp: decoded['exp'],
  };
}

/**
 * Verifies a refresh token using JWT_REFRESH_SECRET and validates token type.
 */
export function verifyRefreshToken(
  token: string,
  customSecret?: string
): DecodedRefreshToken {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token provided');
  }

  const secret = customSecret || env.JWT_REFRESH_SECRET;
  const decoded = jwt.verify(token, secret);

  if (typeof decoded === 'string' || !decoded) {
    throw new Error('Malformed token payload');
  }

  if (decoded['tokenType'] !== 'refresh') {
    throw new Error('Invalid token type. Expected refresh token');
  }

  return {
    userId: decoded['userId'],
    tokenType: 'refresh',
    iat: decoded['iat'],
    exp: decoded['exp'],
  };
}
