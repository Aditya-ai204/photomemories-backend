import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, UserRole } from '../utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../utils/cookies';
import { AppError } from '../types';

/**
 * Authoritative Authentication Middleware
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 24, 30)
 * - Reads access token primarily from httpOnly cookie
 * - Supports Authorization: Bearer <token> fallback
 * - Validates JWT signature, expiry (24h), and token type
 * - Attaches decoded user payload to Express request
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  let token: string | undefined;

  // 1. Check httpOnly cookie (PRD Pages 24, 30)
  if (req.cookies) {
    token = req.cookies[ACCESS_TOKEN_COOKIE_NAME] || req.cookies['token'];
  }

  // 2. Authorization header fallback (Bearer <token>)
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  // 3. Reject missing authentication
  if (!token) {
    return next(new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED'));
  }

  // 4. Verify token
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    return next();
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return next(new AppError('Access token has expired', 401, 'TOKEN_EXPIRED'));
    }
    // Token verification failure (invalid signature, malformed, wrong token type)
    return next(new AppError('Invalid access token', 401, 'INVALID_TOKEN'));
  }
}

/**
 * Authoritative Role Authorization Middleware
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 6, 11-19)
 * Enforces role-based access control: 'photographer' | 'admin'
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Forbidden: Insufficient permissions', 403, 'FORBIDDEN'));
    }

    return next();
  };
}
