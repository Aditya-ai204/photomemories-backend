import { query } from '../database';
import { AppError } from '../types';
import { logger } from '../utils/logger';

/**
 * Authoritative Subdomain Service
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 4, 6, 11-12, 20, 22, 25, 26)
 * - "Backend creates subdomain: 'john-photography.photomemories.ai'"
 * - "Stores in users table"
 * - "Store in subdomains table"
 * - Subdomain format: lowercase alphanumeric with hyphens, 3 to 63 chars
 */

export const RESERVED_SUBDOMAINS = new Set([
  'api',
  'admin',
  'www',
  'mail',
  'auth',
  'app',
  'dev',
  'staging',
  'test',
  'support',
  'help',
  'static',
  'cdn',
  'photomemories',
]);

export const BASE_DOMAIN = 'photomemories.ai';

/**
 * Validates and sanitizes a raw string into a valid DNS subdomain slug.
 * Example: "John Photography" -> "john-photography"
 */
export function sanitizeSubdomain(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .toLowerCase()
    .trim()
    // Replace non-alphanumeric characters with hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // Remove leading and trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Enforce DNS label maximum length of 63 characters
    .slice(0, 63);
}

/**
 * Checks if a subdomain matches DNS label formatting rules.
 */
export function isValidSubdomainFormat(subdomain: string): boolean {
  if (!subdomain || typeof subdomain !== 'string') {
    return false;
  }
  // DNS label regex: 3-63 alphanumeric characters and hyphens, not starting or ending with hyphen
  const dnsRegex = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
  return dnsRegex.test(subdomain);
}

/**
 * Checks if a subdomain is reserved.
 */
export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

/**
 * Formats full FQDN for a photographer subdomain.
 * Example: "john-photography" -> "john-photography.photomemories.ai"
 */
export function formatFullDomain(subdomain: string): string {
  const sanitized = sanitizeSubdomain(subdomain);
  return `${sanitized}.${BASE_DOMAIN}`;
}

/**
 * Checks if a subdomain is available (not reserved, and not present in users or subdomains tables).
 */
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> {
  const sanitized = sanitizeSubdomain(subdomain);

  if (!isValidSubdomainFormat(sanitized)) {
    return false;
  }

  if (isReservedSubdomain(sanitized)) {
    return false;
  }

  try {
    // Check in users table
    const userResult = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM users WHERE LOWER(subdomain) = LOWER($1)',
      [sanitized]
    );
    if (parseInt(userResult.rows[0]?.count ?? '0', 10) > 0) {
      return false;
    }

    // Check in subdomains table
    const subdomainResult = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM subdomains WHERE LOWER(subdomain_name) = LOWER($1)',
      [sanitized]
    );
    if (parseInt(subdomainResult.rows[0]?.count ?? '0', 10) > 0) {
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error checking subdomain availability', error);
    throw new AppError('Failed to verify subdomain availability', 500, 'DATABASE_ERROR');
  }
}

/**
 * Generates an available, unique photographer subdomain slug based on company name or user name.
 * Handles collisions deterministically by appending sequential suffixes (-1, -2, etc.).
 */
export async function generateUniqueSubdomain(
  preferredName: string,
  fallbackName?: string
): Promise<string> {
  let base = sanitizeSubdomain(preferredName);

  if (!base || base.length < 3) {
    base = sanitizeSubdomain(fallbackName || '');
  }

  if (!base || base.length < 3) {
    base = 'photographer';
  }

  // Check if base is available
  if (await isSubdomainAvailable(base)) {
    return base;
  }

  // Deterministically find available suffix: base-1, base-2, ...
  let counter = 1;
  while (counter <= 100) {
    const candidate = `${base}-${counter}`;
    if (candidate.length <= 63 && (await isSubdomainAvailable(candidate))) {
      return candidate;
    }
    counter++;
  }

  // If counter exceeded, append random numeric suffix
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${base.slice(0, 58)}-${randomSuffix}`;
}

/**
 * Assigns and records a subdomain for a photographer in both `subdomains` and `users` tables.
 * Used during signup and POST /api/subdomains/create per PRD Pages 22 & 26.
 */
export async function assignSubdomain(
  photographerId: number,
  subdomainName: string
): Promise<{ subdomain: string; fullDomain: string }> {
  const sanitized = sanitizeSubdomain(subdomainName);

  if (!isValidSubdomainFormat(sanitized)) {
    throw new AppError(
      'Invalid subdomain format. Must be 3-63 alphanumeric characters and hyphens.',
      400,
      'INVALID_SUBDOMAIN'
    );
  }

  if (isReservedSubdomain(sanitized)) {
    throw new AppError('This subdomain is reserved.', 400, 'RESERVED_SUBDOMAIN');
  }

  const available = await isSubdomainAvailable(sanitized);
  if (!available) {
    throw new AppError('Subdomain is already taken.', 409, 'SUBDOMAIN_CONFLICT');
  }

  try {
    // 1. Insert into subdomains table (PRD Page 26)
    await query(
      `INSERT INTO subdomains (photographer_id, subdomain_name, is_active)
       VALUES ($1, $2, true)`,
      [photographerId, sanitized]
    );

    // 2. Update users table subdomain field (PRD Pages 6, 22)
    await query(
      `UPDATE users
       SET subdomain = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [sanitized, photographerId]
    );

    logger.info(`Assigned subdomain [${sanitized}] to photographer ID [${photographerId}]`);

    return {
      subdomain: sanitized,
      fullDomain: formatFullDomain(sanitized),
    };
  } catch (error) {
    logger.error('Failed to assign subdomain', error);
    throw new AppError('Failed to record subdomain in database', 500, 'DATABASE_ERROR');
  }
}
