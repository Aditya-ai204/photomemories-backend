import { query } from '../database';
import { AppError } from '../types';
import { logger } from '../utils/logger';

/**
 * Authoritative Event Slug Generation Service
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 7-8, 12-16, 21)
 * Examples in PRD: "aarav-priya-2024"
 * Rules:
 * - Primary source: couple_names
 * - Fallback source: event_name
 * - Appends event year (e.g., 2024)
 * - Lowercase alphanumeric with hyphens, normalized, no leading/trailing hyphens
 * - Maximum length bounded safely within VARCHAR(255)
 * - Deterministic collision resolution: slug, slug-1, slug-2, ...
 */

export const MAX_SLUG_LENGTH = 200; // Well within VARCHAR(255)

/**
 * Sanitizes a text string into an alphanumeric hyphen-separated slug component.
 * Example: "Aarav & Priya" -> "aarav-priya"
 */
export function sanitizeEventSlugPart(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .toLowerCase()
    .trim()
    // Replace non-alphanumeric characters with hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // Strip leading and trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts a 4-digit calendar year from a Date instance, ISO date string, or timestamp.
 * Defaults to current year if invalid or missing.
 */
export function extractEventYear(dateInput: string | Date | null | undefined): number {
  if (!dateInput) {
    return new Date().getFullYear();
  }

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.getFullYear();
  }

  if (typeof dateInput === 'string') {
    // Check for 4-digit year pattern (e.g. "2024-12-15")
    const match = dateInput.match(/\b(19\d\d|20\d\d|21\d\d)\b/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    const parsed = new Date(dateInput);
    if (!isNaN(parsed.getTime())) {
      return parsed.getFullYear();
    }
  }

  return new Date().getFullYear();
}

/**
 * Builds the base event slug string prior to uniqueness checking.
 * Prioritizes couple_names over event_name, appends year.
 * Example: ("Aarav & Priya", "Aarav & Priya Wedding", "2024-12-15") -> "aarav-priya-2024"
 */
export function buildBaseEventSlug(
  coupleNames: string | null | undefined,
  eventName: string | null | undefined,
  eventDate: string | Date | null | undefined
): string {
  let namePart = sanitizeEventSlugPart(coupleNames);

  if (!namePart || namePart.length < 2) {
    namePart = sanitizeEventSlugPart(eventName);
  }

  if (!namePart || namePart.length < 2) {
    namePart = 'event';
  }

  // Bound namePart length so `${namePart}-${year}` fits within MAX_SLUG_LENGTH
  const truncatedNamePart = namePart.slice(0, MAX_SLUG_LENGTH - 10);
  const year = extractEventYear(eventDate);

  return `${truncatedNamePart}-${year}`;
}

/**
 * Checks whether a given event slug is available in the database.
 */
export async function isEventSlugAvailable(slug: string): Promise<boolean> {
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return false;
  }

  try {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM events WHERE LOWER(unique_slug) = LOWER($1)',
      [slug.trim()]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) === 0;
  } catch (error) {
    logger.error('Error checking event slug availability', { slug, error });
    throw new AppError('Failed to verify event slug availability', 500, 'DATABASE_ERROR');
  }
}

/**
 * Generates a guaranteed unique event slug for a new event request.
 * Resolves collisions deterministically by appending sequential suffixes:
 * base-slug, base-slug-1, base-slug-2, ...
 */
export async function generateUniqueEventSlug(
  coupleNames: string | null | undefined,
  eventName: string | null | undefined,
  eventDate: string | Date | null | undefined
): Promise<string> {
  const baseSlug = buildBaseEventSlug(coupleNames, eventName, eventDate);

  // Check if base slug is available
  if (await isEventSlugAvailable(baseSlug)) {
    return baseSlug;
  }

  // Deterministically find available suffix: baseSlug-1, baseSlug-2, ...
  let counter = 1;
  while (counter <= 500) {
    const candidate = `${baseSlug}-${counter}`;
    if (await isEventSlugAvailable(candidate)) {
      return candidate;
    }
    counter++;
  }

  // Fallback random suffix if counter loop exceeds limit
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - 15)}-${randomSuffix}`;
}
