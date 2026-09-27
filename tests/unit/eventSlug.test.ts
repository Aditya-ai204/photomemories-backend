import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeEventSlugPart,
  extractEventYear,
  buildBaseEventSlug,
  isEventSlugAvailable,
  generateUniqueEventSlug,
  MAX_SLUG_LENGTH,
} from '../../src/services/eventSlugService';
import * as db from '../../src/database';
import { AppError } from '../../src/types';

vi.mock('../../src/database', () => ({
  query: vi.fn(),
}));

describe('Event Slug Service (src/services/eventSlugService.ts)', () => {
  const queryMock = vi.mocked(db.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeEventSlugPart', () => {
    it('converts normal couple names to lowercase hyphenated format', () => {
      expect(sanitizeEventSlugPart('Aarav & Priya')).toBe('aarav-priya');
      expect(sanitizeEventSlugPart('Rohan and Simran')).toBe('rohan-and-simran');
    });

    it('converts spaces to hyphens and lowercases all characters', () => {
      expect(sanitizeEventSlugPart('ANANYA AND KABIR')).toBe('ananya-and-kabir');
      expect(sanitizeEventSlugPart('Vikram   Aditya')).toBe('vikram-aditya');
    });

    it('removes special characters and punctuation', () => {
      expect(sanitizeEventSlugPart('Rajesh & Meera @ Goa!')).toBe('rajesh-meera-goa');
      expect(sanitizeEventSlugPart('Kavya + Rahul #2024*')).toBe('kavya-rahul-2024');
    });

    it('normalizes multiple consecutive separators into single hyphens', () => {
      expect(sanitizeEventSlugPart('Aarav---Priya...Wedding')).toBe('aarav-priya-wedding');
      expect(sanitizeEventSlugPart('Neha___Varun---Reception')).toBe('neha-varun-reception');
    });

    it('removes leading and trailing hyphens and separators', () => {
      expect(sanitizeEventSlugPart('---Aarav & Priya---')).toBe('aarav-priya');
      expect(sanitizeEventSlugPart('***Wedding Event***')).toBe('wedding-event');
    });

    it('returns empty string for null, undefined, or empty inputs', () => {
      expect(sanitizeEventSlugPart('')).toBe('');
      expect(sanitizeEventSlugPart(null)).toBe('');
      expect(sanitizeEventSlugPart(undefined)).toBe('');
    });
  });

  describe('extractEventYear', () => {
    it('extracts year from ISO date string (YYYY-MM-DD)', () => {
      expect(extractEventYear('2024-12-15')).toBe(2024);
      expect(extractEventYear('2025-01-01')).toBe(2025);
    });

    it('extracts year from Date object', () => {
      const date = new Date(Date.UTC(2026, 5, 20));
      expect(extractEventYear(date)).toBe(2026);
    });

    it('falls back to current year when input is invalid or missing', () => {
      const currentYear = new Date().getFullYear();
      expect(extractEventYear('')).toBe(currentYear);
      expect(extractEventYear(null)).toBe(currentYear);
      expect(extractEventYear('invalid-date')).toBe(currentYear);
    });
  });

  describe('buildBaseEventSlug', () => {
    it('builds PRD exact example slug: "aarav-priya-2024"', () => {
      const slug = buildBaseEventSlug('Aarav & Priya', 'Aarav & Priya Wedding', '2024-12-15');
      expect(slug).toBe('aarav-priya-2024');
    });

    it('prefers couple_names over event_name', () => {
      const slug = buildBaseEventSlug('Siddharth & Kiara', 'Grand Royal Wedding Celebration', '2024-02-07');
      expect(slug).toBe('siddharth-kiara-2024');
    });

    it('falls back to event_name when couple_names is missing or empty', () => {
      const slug1 = buildBaseEventSlug('', 'Mehta Anniversary', '2025-08-10');
      expect(slug1).toBe('mehta-anniversary-2025');

      const slug2 = buildBaseEventSlug(null, 'Sharma Sangeet Night', '2024-11-20');
      expect(slug2).toBe('sharma-sangeet-night-2024');
    });

    it('falls back to "event" when both couple_names and event_name are empty or invalid', () => {
      const slug = buildBaseEventSlug('', '!!!', '2024-05-01');
      expect(slug).toBe('event-2024');
    });

    it('safely bounds length for very long names', () => {
      const longName = 'A'.repeat(300);
      const slug = buildBaseEventSlug(longName, null, '2024-10-10');

      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
      expect(slug.endsWith('-2024')).toBe(true);
    });

    it('produces deterministic output for identical inputs', () => {
      const slug1 = buildBaseEventSlug('Aarav & Priya', 'Wedding', '2024-12-15');
      const slug2 = buildBaseEventSlug('Aarav & Priya', 'Wedding', '2024-12-15');
      expect(slug1).toBe(slug2);
    });
  });

  describe('isEventSlugAvailable', () => {
    it('returns true when count is 0', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const available = await isEventSlugAvailable('aarav-priya-2024');
      expect(available).toBe(true);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*)::text as count FROM events WHERE LOWER(unique_slug) = LOWER($1)'),
        ['aarav-priya-2024']
      );
    });

    it('returns false when count is greater than 0', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const available = await isEventSlugAvailable('existing-slug-2024');
      expect(available).toBe(false);
    });

    it('returns false for empty or whitespace slug', async () => {
      expect(await isEventSlugAvailable('')).toBe(false);
      expect(await isEventSlugAvailable('   ')).toBe(false);
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('throws AppError when database query fails', async () => {
      queryMock.mockRejectedValueOnce(new Error('DB failure'));

      await expect(isEventSlugAvailable('slug-2024')).rejects.toThrow(AppError);
    });
  });

  describe('generateUniqueEventSlug (Collision Handling)', () => {
    it('returns base slug directly when available without collision', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const slug = await generateUniqueEventSlug('Aarav & Priya', 'Aarav & Priya Wedding', '2024-12-15');
      expect(slug).toBe('aarav-priya-2024');
    });

    it('resolves collision by appending sequential counter (-1) when base is taken', async () => {
      // 1. Base slug check ('aarav-priya-2024') -> taken
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);
      // 2. Candidate check ('aarav-priya-2024-1') -> available
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const slug = await generateUniqueEventSlug('Aarav & Priya', 'Wedding', '2024-12-15');
      expect(slug).toBe('aarav-priya-2024-1');
    });

    it('resolves multiple collisions sequentially (-1 taken, -2 available)', async () => {
      // 1. Base slug check ('aarav-priya-2024') -> taken
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);
      // 2. Candidate check ('aarav-priya-2024-1') -> taken
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);
      // 3. Candidate check ('aarav-priya-2024-2') -> available
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const slug = await generateUniqueEventSlug('Aarav & Priya', 'Wedding', '2024-12-15');
      expect(slug).toBe('aarav-priya-2024-2');
    });
  });
});
