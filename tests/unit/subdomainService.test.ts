import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeSubdomain,
  isValidSubdomainFormat,
  isReservedSubdomain,
  formatFullDomain,
  isSubdomainAvailable,
  generateUniqueSubdomain,
  assignSubdomain,
  BASE_DOMAIN,
} from '../../src/services/subdomainService';
import * as db from '../../src/database';

vi.mock('../../src/database', () => ({
  query: vi.fn(),
}));

describe('Subdomain Service (src/services/subdomainService.ts)', () => {
  const queryMock = vi.mocked(db.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sanitization & Format Validation', () => {
    it('sanitizes raw company names into valid DNS subdomain slugs', () => {
      expect(sanitizeSubdomain('John Photography')).toBe('john-photography');
      expect(sanitizeSubdomain('  Aarav & Priya Studio! ')).toBe('aarav-priya-studio');
      expect(sanitizeSubdomain('Photo---Memories')).toBe('photo-memories');
      expect(sanitizeSubdomain('___Special__Chars***')).toBe('special-chars');
    });

    it('enforces maximum DNS label length of 63 characters', () => {
      const veryLongName = 'a'.repeat(100);
      const sanitized = sanitizeSubdomain(veryLongName);
      expect(sanitized.length).toBe(63);
    });

    it('validates DNS subdomain formats correctly', () => {
      expect(isValidSubdomainFormat('john-photography')).toBe(true);
      expect(isValidSubdomainFormat('studio123')).toBe(true);
      expect(isValidSubdomainFormat('ab')).toBe(false); // Too short (< 3 chars)
      expect(isValidSubdomainFormat('-starts-with-hyphen')).toBe(false);
      expect(isValidSubdomainFormat('ends-with-hyphen-')).toBe(false);
      expect(isValidSubdomainFormat('has spaces')).toBe(false);
      expect(isValidSubdomainFormat('')).toBe(false);
    });

    it('identifies reserved system subdomains', () => {
      expect(isReservedSubdomain('api')).toBe(true);
      expect(isReservedSubdomain('admin')).toBe(true);
      expect(isReservedSubdomain('www')).toBe(true);
      expect(isReservedSubdomain('auth')).toBe(true);
      expect(isReservedSubdomain('photographer-john')).toBe(false);
    });

    it('formats full FQDN domain string accurately per PRD page 20', () => {
      expect(formatFullDomain('john-photography')).toBe(`john-photography.${BASE_DOMAIN}`);
    });
  });

  describe('Availability & Collision Resolution', () => {
    it('returns true when subdomain is not taken and not reserved', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // users check
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // subdomains check

      const available = await isSubdomainAvailable('unique-studio');
      expect(available).toBe(true);
    });

    it('returns false when subdomain exists in users table', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const available = await isSubdomainAvailable('taken-studio');
      expect(available).toBe(false);
    });

    it('returns false when subdomain exists in subdomains table', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // users
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never); // subdomains

      const available = await isSubdomainAvailable('taken-subdomain');
      expect(available).toBe(false);
    });

    it('returns false for reserved subdomains without querying database', async () => {
      const available = await isSubdomainAvailable('admin');
      expect(available).toBe(false);
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('generates a unique subdomain without collision if base is available', async () => {
      queryMock.mockResolvedValue({ rows: [{ count: '0' }] } as never);

      const subdomain = await generateUniqueSubdomain('John Photography');
      expect(subdomain).toBe('john-photography');
    });

    it('resolves collision by appending sequential counter if base is taken', async () => {
      // First call for 'john-photography': taken in users
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      // Second check for 'john-photography-1': available in users and subdomains
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const subdomain = await generateUniqueSubdomain('John Photography');
      expect(subdomain).toBe('john-photography-1');
    });

    it('falls back to user name if company name produces invalid slug', async () => {
      queryMock.mockResolvedValue({ rows: [{ count: '0' }] } as never);

      const subdomain = await generateUniqueSubdomain('!', 'John Doe');
      expect(subdomain).toBe('john-doe');
    });

    it('falls back to default "photographer" if both inputs are invalid', async () => {
      queryMock.mockResolvedValue({ rows: [{ count: '0' }] } as never);

      const subdomain = await generateUniqueSubdomain('!', '??');
      expect(subdomain).toBe('photographer');
    });
  });

  describe('Database Assignment (assignSubdomain)', () => {
    it('successfully assigns and persists subdomain for photographer', async () => {
      // Availability check queries
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      // Insertion & update queries
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);
      queryMock.mockResolvedValueOnce({ rowCount: 1 } as never);

      const result = await assignSubdomain(42, 'john-photography');

      expect(result.subdomain).toBe('john-photography');
      expect(result.fullDomain).toBe(`john-photography.${BASE_DOMAIN}`);

      // Verify insertion into subdomains table
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO subdomains'),
        [42, 'john-photography']
      );

      // Verify update in users table
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        ['john-photography', 42]
      );
    });

    it('rejects invalid subdomain format with 400 AppError', async () => {
      await expect(assignSubdomain(42, 'ab')).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'INVALID_SUBDOMAIN',
        })
      );
    });

    it('rejects reserved subdomains with 400 AppError', async () => {
      await expect(assignSubdomain(42, 'admin')).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'RESERVED_SUBDOMAIN',
        })
      );
    });

    it('rejects already taken subdomain with 409 SUBDOMAIN_CONFLICT', async () => {
      // Taken check
      queryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      await expect(assignSubdomain(42, 'existing-subdomain')).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          code: 'SUBDOMAIN_CONFLICT',
        })
      );
    });
  });
});
