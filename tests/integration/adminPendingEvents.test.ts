import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';

// Mock database module
vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

describe('Admin Event Listing Integration (GET /api/admin/events/pending & GET /api/admin/events)', () => {
  const queryMock = vi.mocked(db.query);

  const adminToken = signAccessToken({
    userId: 1,
    email: 'krish.admin@photomemories.ai',
    role: 'admin',
  });

  const photographerToken = signAccessToken({
    userId: 10,
    email: 'rohan.photographer@example.com',
    role: 'photographer',
  });

  const mockPendingRows = [
    {
      id: 42,
      event_name: 'Aarav & Priya Wedding',
      photographer_name: 'John Doe',
      photographer_email: 'john@example.com',
      plan: 'pro',
      amount_paid: '25000.00',
      requested_at: new Date('2024-09-21T10:30:00Z'),
    },
    {
      id: 43,
      event_name: 'Vikram & Ananya Reception',
      photographer_name: 'Suresh Kumar',
      photographer_email: 'suresh@example.com',
      plan: 'medium',
      amount_paid: '15000.00',
      requested_at: new Date('2024-09-22T14:15:00Z'),
    },
  ];

  const mockAdminEventRow = {
    id: 42,
    event_name: 'Aarav & Priya Wedding',
    couple_names: 'Aarav & Priya',
    event_date: '2024-12-15',
    theme: 'traditional',
    location: 'Delhi',
    status: 'ready_for_upload',
    plan: 'pro',
    amount_paid: '25000.00',
    payment_status: 'completed',
    photographer_id: 10,
    photographer_name: 'John Doe',
    photographer_email: 'john@example.com',
    photo_count: 0,
    video_count: 0,
    view_count: 0,
    unique_slug: 'aarav-priya-2024',
    ready_at: new Date('2024-09-25T10:30:00Z'),
    went_live_at: null,
    created_at: new Date('2024-09-21T10:30:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ======================================================================
  // 1. GET /api/admin/events/pending (PRD Pages 17-18)
  // ======================================================================
  describe('GET /api/admin/events/pending', () => {
    it('returns 200 with pending events for authenticated admin', async () => {
      queryMock.mockResolvedValueOnce({
        rows: mockPendingRows,
        rowCount: mockPendingRows.length,
      } as any);

      const response = await request(app)
        .get('/api/admin/events/pending')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.pending_events)).toBe(true);
      expect(response.body.pending_events.length).toBe(2);

      const first = response.body.pending_events[0];
      expect(first).toEqual({
        id: 42,
        event_name: 'Aarav & Priya Wedding',
        photographer_name: 'John Doe',
        photographer_email: 'john@example.com',
        plan: 'pro',
        amount_paid: 25000,
        requested_at: '2024-09-21T10:30:00.000Z',
      });

      // Verify SQL contains status = 'pending'
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("WHERE e.status = 'pending'")
      );
    });

    it('works with Authorization: Bearer <token> header fallback', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .get('/api/admin/events/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.pending_events).toEqual([]);
    });

    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const response = await request(app).get('/api/admin/events/pending');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects authenticated photographer with 403 FORBIDDEN', async () => {
      const response = await request(app)
        .get('/api/admin/events/pending')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('returns empty array when no pending events exist', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .get('/api/admin/events/pending')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        pending_events: [],
      });
    });

    it('does not expose passwords, hashes, tokens, or raw encrypted contact fields', async () => {
      queryMock.mockResolvedValueOnce({
        rows: mockPendingRows,
        rowCount: mockPendingRows.length,
      } as any);

      const response = await request(app)
        .get('/api/admin/events/pending')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      const resString = JSON.stringify(response.body);
      expect(resString).not.toContain('password');
      expect(resString).not.toContain('password_hash');
      expect(resString).not.toContain('verification_token');
      expect(resString).not.toContain('client_phone');
    });
  });

  // ======================================================================
  // 2. GET /api/admin/events (PRD Page 19)
  // ======================================================================
  describe('GET /api/admin/events', () => {
    it('returns 200 with all events and pagination for authenticated admin', async () => {
      // 1. Total count query
      queryMock.mockResolvedValueOnce({
        rows: [{ total: '1' }],
        rowCount: 1,
      } as any);
      // 2. Data query
      queryMock.mockResolvedValueOnce({
        rows: [mockAdminEventRow],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .get('/api/admin/events')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.events)).toBe(true);
      expect(response.body.events.length).toBe(1);

      const evt = response.body.events[0];
      expect(evt.id).toBe(42);
      expect(evt.event_name).toBe('Aarav & Priya Wedding');
      expect(evt.photographer_name).toBe('John Doe');
      expect(evt.photographer_email).toBe('john@example.com');
      expect(evt.photographer_id).toBe(10);
      expect(evt.plan).toBe('pro');
      expect(evt.amount_paid).toBe(25000);
      expect(evt.payment_status).toBe('completed');
      expect(evt.status).toBe('ready_for_upload');
      expect(evt.ready_at).toBe('2024-09-25T10:30:00.000Z');

      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        total_pages: 1,
      });
    });

    it('filters events by status when valid status query parameter is provided', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [mockAdminEventRow], rowCount: 1 } as any);

      const response = await request(app)
        .get('/api/admin/events?status=ready_for_upload')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('e.status = $1'),
        ['ready_for_upload']
      );
    });

    it('rejects invalid status filter with 400 INVALID_STATUS', async () => {
      const response = await request(app)
        .get('/api/admin/events?status=invalid_status_xyz')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_STATUS');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('filters events by photographer_id when valid integer is provided', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [mockAdminEventRow], rowCount: 1 } as any);

      const response = await request(app)
        .get('/api/admin/events?photographer_id=10')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('e.photographer_id = $1'),
        [10]
      );
    });

    it('rejects non-numeric photographer_id filter with 400 INVALID_PHOTOGRAPHER_ID', async () => {
      const response = await request(app)
        .get('/api/admin/events?photographer_id=abc')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_PHOTOGRAPHER_ID');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('filters by both status and photographer_id simultaneously with parameterized query', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [mockAdminEventRow], rowCount: 1 } as any);

      const response = await request(app)
        .get('/api/admin/events?status=pending&photographer_id=10')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('e.status = $1 AND e.photographer_id = $2'),
        ['pending', 10]
      );
    });

    it('supports custom pagination parameters (page, limit)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '45' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const response = await request(app)
        .get('/api/admin/events?page=3&limit=15')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination).toEqual({
        page: 3,
        limit: 15,
        total: 45,
        total_pages: 3,
      });

      // Offset should be (3 - 1) * 15 = 30
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [15, 30]
      );
    });

    it('safely handles whitelisted sortBy parameter (amount_paid)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [mockAdminEventRow], rowCount: 1 } as any);

      const response = await request(app)
        .get('/api/admin/events?sortBy=amount_paid')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY e.amount_paid DESC'),
        [10, 0]
      );
    });

    it('rejects unauthenticated request to /api/admin/events with 401', async () => {
      const response = await request(app).get('/api/admin/events');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects photographer request to /api/admin/events with 403', async () => {
      const response = await request(app)
        .get('/api/admin/events')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('returns empty list and total_pages 0 when no events match', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const response = await request(app)
        .get('/api/admin/events?status=archived')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        events: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          total_pages: 0,
        },
      });
    });
  });
});
