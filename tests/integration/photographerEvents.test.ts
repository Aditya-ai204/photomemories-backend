import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';
import { encryptData } from '../../src/utils/crypto';

// Mock database query
vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

describe('Photographer Event Endpoints Integration (/api/photographer/events)', () => {
  const queryMock = vi.mocked(db.query);

  const photographer1Token = signAccessToken({
    userId: 101,
    email: 'photographer1@example.com',
    role: 'photographer',
  });

  const photographer2Token = signAccessToken({
    userId: 202,
    email: 'photographer2@example.com',
    role: 'photographer',
  });

  const adminToken = signAccessToken({
    userId: 1,
    email: 'admin@photomemories.ai',
    role: 'admin',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ======================================================================
  // LIST ENDPOINT: GET /api/photographer/events
  // ======================================================================
  describe('GET /api/photographer/events', () => {
    const mockEventsList = [
      {
        id: 42,
        event_name: 'Aarav & Priya Wedding',
        couple_names: 'Aarav & Priya',
        event_date: '2024-12-15',
        theme: 'traditional',
        location: 'Delhi',
        status: 'ready_for_upload',
        plan: 'pro',
        photo_count: 0,
        video_count: 0,
        view_count: 0,
        ready_at: '2024-09-25T10:30:00Z',
        created_at: '2024-09-21T10:30:00Z',
        unique_slug: 'aarav-priya-2024',
      },
      {
        id: 43,
        event_name: 'Rohan & Ananya Engagement',
        couple_names: 'Rohan & Ananya',
        event_date: '2024-11-20',
        theme: 'modern',
        location: 'Mumbai',
        status: 'pending',
        plan: 'base',
        photo_count: 0,
        video_count: 0,
        view_count: 0,
        ready_at: null,
        created_at: '2024-09-22T08:00:00Z',
        unique_slug: 'rohan-ananya-2024',
      },
    ];

    it('1. authenticated photographer can list own events with exact PRD response structure', async () => {
      // Total count query
      queryMock.mockResolvedValueOnce({ rows: [{ total: '2' }] } as never);
      // Data query
      queryMock.mockResolvedValueOnce({ rows: mockEventsList } as never);

      const res = await request(app)
        .get('/api/photographer/events')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events).toHaveLength(2);

      // Verify PRD Page 14 field structure on list items
      const firstEvent = res.body.events[0];
      expect(firstEvent).toMatchObject({
        id: 42,
        event_name: 'Aarav & Priya Wedding',
        status: 'ready_for_upload',
        plan: 'pro',
        photo_count: 0,
        ready_at: '2024-09-25T10:30:00Z',
      });

      // Verify ownership condition was strictly enforced in SQL query with authenticated user ID
      expect(queryMock).toHaveBeenCalledTimes(2);
      const countCall = queryMock.mock.calls[0];
      const dataCall = queryMock.mock.calls[1];

      expect(countCall![0]).toContain('photographer_id = $1');
      expect(countCall![1]).toEqual([101]);

      expect(dataCall![0]).toContain('photographer_id = $1');
      expect(dataCall![1]![0]).toBe(101);
    });

    it('2. rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/photographer/events');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('3. rejects non-photographer role (admin) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/photographer/events')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('4. enforces that photographer cannot see another photographer events (different photographer ID bound in SQL)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      // Photographer 2 requests their events
      const res = await request(app)
        .get('/api/photographer/events')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer2Token}`]);

      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);

      // Verify photographer 2's ID was strictly queried
      const dataCall = queryMock.mock.calls[1];
      expect(dataCall![1]![0]).toBe(202); // strictly user 202, never user 101
    });

    it('5. handles pagination parameters correctly (page, limit, offset)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '50' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get('/api/photographer/events?page=3&limit=15')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({
        page: 3,
        limit: 15,
        total: 50,
        total_pages: 4,
      });

      const dataCall = queryMock.mock.calls[1];
      const params = dataCall![1] as unknown[];
      // limit = 15, offset = (3 - 1) * 15 = 30
      expect(params).toContain(15);
      expect(params).toContain(30);
    });

    it('6. applies safe sorting parameters (sortBy=event_date)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '2' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: mockEventsList } as never);

      const res = await request(app)
        .get('/api/photographer/events?sortBy=event_date')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      const dataCall = queryMock.mock.calls[1];
      const sql = dataCall![0] as string;
      expect(sql).toContain('ORDER BY event_date DESC');
    });

    it('7. applies status filtering (status=ready_for_upload)', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [mockEventsList[0]] } as never);

      const res = await request(app)
        .get('/api/photographer/events?status=ready_for_upload')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);

      const countCall = queryMock.mock.calls[0];
      const dataCall = queryMock.mock.calls[1];

      expect(countCall![0]).toContain('status = $2');
      expect(countCall![1]).toEqual([101, 'ready_for_upload']);

      expect(dataCall![0]).toContain('status = $2');
      expect(dataCall![1]).toContain('ready_for_upload');
    });

    it('8. rejects invalid status filter with 400 INVALID_STATUS', async () => {
      const res = await request(app)
        .get('/api/photographer/events?status=invalid_status_xyz')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INVALID_STATUS');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('9. handles empty result cleanly with empty array and zero pagination', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '0' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get('/api/photographer/events')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
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

    it('10. sensitive contact details (client_email, client_phone) are NOT leaked in the list response', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ total: '1' }] } as never);
      queryMock.mockResolvedValueOnce({ rows: [mockEventsList[0]] } as never);

      const res = await request(app)
        .get('/api/photographer/events')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      const event = res.body.events[0];
      expect(event).not.toHaveProperty('client_email');
      expect(event).not.toHaveProperty('client_phone');
    });
  });

  // ======================================================================
  // SINGLE EVENT ENDPOINT: GET /api/photographer/events/:eventId
  // ======================================================================
  describe('GET /api/photographer/events/:eventId', () => {
    const rawCipherEmail = encryptData('client@example.com');
    const rawCipherPhone = encryptData('9876543210');

    const mockEventDbRow = {
      id: 42,
      photographer_id: 101,
      event_name: 'Aarav & Priya Wedding',
      couple_names: 'Aarav & Priya',
      event_date: '2024-12-15',
      theme: 'traditional',
      location: 'Delhi',
      client_email: rawCipherEmail,
      client_phone: rawCipherPhone,
      plan: 'pro',
      status: 'live',
      unique_slug: 'aarav-priya-2024',
      description: 'Wedding ceremony and reception',
      invitation_html: '<html><body>Invitation Card</body></html>',
      landing_page_html: '<html><body>Landing Page</body></html>',
      photo_count: 2,
      video_count: 0,
      view_count: 15,
      amount_paid: '25000.00',
      payment_status: 'completed',
      ready_at: '2024-09-25T10:30:00Z',
      went_live_at: '2024-09-26T12:00:00Z',
      created_at: '2024-09-21T10:30:00Z',
    };

    const mockPhotos = [
      {
        id: 101,
        event_id: 42,
        uploaded_by: 101,
        cloudinary_id: 'cld_photo_1',
        cloudinary_url: 'https://cloudinary.com/photo1.jpg',
        cloudinary_thumb_url: 'https://cloudinary.com/thumb1.jpg',
        file_type: 'photo',
        created_at: '2024-09-26T11:00:00Z',
      },
      {
        id: 102,
        event_id: 42,
        uploaded_by: 101,
        cloudinary_id: 'cld_photo_2',
        cloudinary_url: 'https://cloudinary.com/photo2.jpg',
        cloudinary_thumb_url: 'https://cloudinary.com/thumb2.jpg',
        file_type: 'photo',
        created_at: '2024-09-26T11:05:00Z',
      },
    ];

    it('11. authenticated photographer can retrieve own event with decrypted contact data and photos', async () => {
      // 1. Single event query with ownership check
      queryMock.mockResolvedValueOnce({ rows: [mockEventDbRow] } as never);
      // 2. Photos query
      queryMock.mockResolvedValueOnce({ rows: mockPhotos } as never);

      const res = await request(app)
        .get('/api/photographer/events/42')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const event = res.body.event;
      expect(event).toBeDefined();

      // PRD Page 15 expected fields
      expect(event.id).toBe(42);
      expect(event.event_name).toBe('Aarav & Priya Wedding');
      expect(event.status).toBe('live');
      expect(event.plan).toBe('pro');
      expect(event.unique_slug).toBe('aarav-priya-2024');
      expect(event.invitation_html).toBe('<html><body>Invitation Card</body></html>');
      expect(event.landing_page_html).toBe('<html><body>Landing Page</body></html>');
      expect(event.photos).toHaveLength(2);
      expect(event.photos[0].cloudinary_id).toBe('cld_photo_1');

      // Contact details must be decrypted from ciphertext (Req 17)
      expect(event.client_email).toBe('client@example.com');
      expect(event.client_phone).toBe('9876543210');

      // Verify ownership condition was directly applied in SQL
      expect(queryMock).toHaveBeenCalledTimes(2);
      const eventQueryCall = queryMock.mock.calls[0];
      const sql = eventQueryCall![0] as string;
      const params = eventQueryCall![1] as unknown[];

      expect(sql).toContain('id = $1');
      expect(sql).toContain('photographer_id = $2');
      expect(params).toEqual([42, 101]);
    });

    it('12. unauthenticated single event request rejected with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/photographer/events/42');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('13. non-photographer role (admin) rejected with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/photographer/events/42')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('14. nonexistent event returns 404 NOT_FOUND', async () => {
      // Event query returns 0 rows
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get('/api/photographer/events/9999')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.error).toContain('Event not found');
    });

    it('15 & 16. another photographer event cannot be accessed (ownership enforced via SQL)', async () => {
      // Photographer 202 tries to access Event 42 (owned by 101)
      // Because query specifies WHERE id = 42 AND photographer_id = 202, DB returns 0 rows
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get('/api/photographer/events/42')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer2Token}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('NOT_FOUND');

      // Verify the query strictly bound photographer 202's ID
      const eventQueryCall = queryMock.mock.calls[0];
      expect(eventQueryCall![1]).toEqual([42, 202]);
    });

    it('18. exact response structure matches PRD Page 15 requirements', async () => {
      queryMock.mockResolvedValueOnce({ rows: [mockEventDbRow] } as never);
      queryMock.mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get('/api/photographer/events/42')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('event');
      expect(res.body.event).toMatchObject({
        id: 42,
        event_name: 'Aarav & Priya Wedding',
        status: 'live',
        plan: 'pro',
        invitation_html: '<html><body>Invitation Card</body></html>',
        landing_page_html: '<html><body>Landing Page</body></html>',
        unique_slug: 'aarav-priya-2024',
        photos: [],
      });
    });

    it('19. invalid/malformed event ID returns 400 INVALID_ID', async () => {
      const res = await request(app)
        .get('/api/photographer/events/not-a-number')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INVALID_ID');
      expect(res.body.error).toContain('Invalid event ID');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('19b. zero or negative event ID returns 400 INVALID_ID', async () => {
      const res = await request(app)
        .get('/api/photographer/events/-5')
        .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographer1Token}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INVALID_ID');
      expect(queryMock).not.toHaveBeenCalled();
    });
  });
});
