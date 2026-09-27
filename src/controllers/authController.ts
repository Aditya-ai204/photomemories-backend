import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../database';
import { AppError } from '../types';
import { hashPassword, comparePassword } from '../utils/password';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies';
import {
  generateUniqueSubdomain,
  assignSubdomain,
  formatFullDomain,
} from '../services/subdomainService';
import {
  generateSecureToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  PASSWORD_RESET_EXPIRY_MS,
} from '../services/emailService';
import { logger } from '../utils/logger';

/**
 * Authoritative Authentication Validation Schemas
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 11-12)
 */

export const signupSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().trim().min(1, 'Name is required'),
  company_name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Verification token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

interface UserRecord {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  role: 'photographer' | 'admin';
  company_name: string | null;
  phone: string | null;
  subdomain: string | null;
  city: string | null;
  created_at: Date;
  updated_at: Date;
  last_login: Date | null;
  is_active: boolean;
  email_verified: boolean;
  verification_token: string | null;
  password_reset_token: string | null;
  password_reset_expires: Date | null;
}

/**
 * POST /api/auth/signup
 * Request: { email, password, name, company_name, phone }
 * Response: { success, user, token, subdomain }
 * Source: PRD Pages 11-12, 22, 25
 */
export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = signupSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase();

    // 1. Check if email already registered
    const existingUser = await query<{ id: number }>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }

    // 2. Hash password (bcrypt cost 10 per PRD Page 23)
    const passwordHash = await hashPassword(validated.password);

    // 3. Generate unique photographer subdomain (PRD Pages 11, 25)
    const subdomainCandidate = await generateUniqueSubdomain(
      validated.company_name || validated.name,
      validated.name
    );

    // 4. Generate verification token (PRD Page 11-12)
    const verificationToken = generateSecureToken();

    // 5. Insert user record into users table
    const insertResult = await query<UserRecord>(
      `INSERT INTO users (
        email, password_hash, name, role, company_name, phone,
        subdomain, is_active, email_verified, verification_token
      ) VALUES ($1, $2, $3, 'photographer', $4, $5, $6, true, false, $7)
      RETURNING id, email, name, role, company_name, phone, subdomain, email_verified, created_at`,
      [
        normalizedEmail,
        passwordHash,
        validated.name,
        validated.company_name || null,
        validated.phone || null,
        subdomainCandidate,
        verificationToken,
      ]
    );

    const newUser = insertResult.rows[0];
    if (!newUser) {
      throw new AppError('Failed to create user account', 500, 'USER_CREATION_FAILED');
    }

    // 6. Record subdomain in subdomains table (PRD Page 26)
    await assignSubdomain(newUser.id, subdomainCandidate);

    // 7. Dispatch verification email (PRD Pages 11-12)
    sendVerificationEmail(newUser.email, verificationToken, newUser.name || undefined).catch(
      (err) => {
        logger.error('Failed to dispatch background verification email', err);
      }
    );

    // 8. Sign JWT access (24h) and refresh (7d) tokens (PRD Pages 24, 28)
    const accessToken = signAccessToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });
    const refreshToken = signRefreshToken({
      userId: newUser.id,
    });

    // 9. Set secure httpOnly cookies (PRD Pages 24, 30)
    setAuthCookies(res, accessToken, refreshToken);

    // 10. Respond with PRD-specified payload (PRD Page 11-12)
    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        company_name: newUser.company_name,
        phone: newUser.phone,
        subdomain: newUser.subdomain,
        email_verified: newUser.email_verified,
      },
      token: accessToken,
      subdomain: formatFullDomain(subdomainCandidate),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Request: { email, password }
 * Response: { success, user, token }
 * Source: PRD Page 12
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = loginSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase();

    // 1. Lookup user by email
    const result = await query<UserRecord>(
      `SELECT id, email, password_hash, name, role, company_name, phone,
              subdomain, is_active, email_verified
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    );

    const user = result.rows[0];

    // Generic error to prevent email enumeration
    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // 2. Check if account is active
    if (!user.is_active) {
      throw new AppError('Account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
    }

    // 3. Verify password hash
    const isValidPassword = await comparePassword(validated.password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // 4. Update last_login timestamp
    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // 5. Sign JWT tokens
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken({
      userId: user.id,
    });

    // 6. Set secure httpOnly cookies
    setAuthCookies(res, accessToken, refreshToken);

    // 7. Response per PRD Page 12
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company_name: user.company_name,
        phone: user.phone,
        subdomain: user.subdomain,
        email_verified: user.email_verified,
      },
      token: accessToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/logout
 * Protected Route (Auth Required)
 * Response: { success }
 * Source: PRD Page 12
 */
export async function logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Clear access, refresh, and fallback token cookies
    clearAuthCookies(res);

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/verify-email
 * Request: { token }
 * Response: { success }
 * Source: PRD Page 12
 */
export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = verifyEmailSchema.parse(req.body);

    // Find user with matching verification token
    const result = await query<UserRecord>(
      'SELECT id, email, email_verified FROM users WHERE verification_token = $1',
      [validated.token]
    );

    const user = result.rows[0];
    if (!user) {
      throw new AppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }

    // Mark email as verified and clear verification token
    await query(
      `UPDATE users
       SET email_verified = true, verification_token = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [user.id]
    );

    logger.info(`User ID [${user.id}] verified email [${user.email}] successfully`);

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/forgot-password
 * Request: { email }
 * Response: { success, message }
 * Source: PRD Page 12
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = forgotPasswordSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase();

    // Lookup user
    const result = await query<UserRecord>(
      'SELECT id, email, name, is_active FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    const user = result.rows[0];

    if (user && user.is_active) {
      const resetToken = generateSecureToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);

      await query(
        `UPDATE users
         SET password_reset_token = $1, password_reset_expires = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [resetToken, expiresAt, user.id]
      );

      // Dispatch reset email asynchronously
      sendPasswordResetEmail(user.email, resetToken, user.name || undefined).catch((err) => {
        logger.error('Failed to dispatch background password reset email', err);
      });
    }

    // Always return safe generic success to prevent account enumeration
    res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/reset-password
 * Request: { token, password }
 * Response: { success }
 * Source: PRD Page 12
 */
export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = resetPasswordSchema.parse(req.body);

    // Lookup user by password_reset_token
    const result = await query<UserRecord>(
      `SELECT id, email, password_reset_expires
       FROM users
       WHERE password_reset_token = $1`,
      [validated.token]
    );

    const user = result.rows[0];

    if (!user) {
      throw new AppError('Invalid or expired password reset token', 400, 'INVALID_TOKEN');
    }

    // Check expiration
    if (!user.password_reset_expires || new Date(user.password_reset_expires).getTime() < Date.now()) {
      throw new AppError('Password reset token has expired', 400, 'TOKEN_EXPIRED');
    }

    // Hash new password
    const newHash = await hashPassword(validated.password);

    // Update password and clear reset token & expiration
    await query(
      `UPDATE users
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newHash, user.id]
    );

    logger.info(`Password successfully reset for user ID [${user.id}]`);

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
}
