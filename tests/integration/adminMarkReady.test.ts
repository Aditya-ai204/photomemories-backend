import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';
import { sentEmailsLog } from '../../src/services/emailService';

// Mock database module
vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

describe('Admin Mark Ready Endpoint Integration (POST /api/admin/events/:eventId/mark-ready)', () => {
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

  const validPayload = {
    invitation_html: '<html><body><h1>Save the Date: Aarav & Priya</h1></body></html>',
    landing_page_html: '<html><body><main>Welcome to Aarav & Priya Photo Album</main></body></html>',
    admin_notes: 'Figma invitation card & landing page design approved by Krish',
  };

  const mockPendingEventRow = {
    id: 42,
    event_name: 'Aarav & Priya Wedding',
    status: 'pending',
    photographer_id: 10,
    photographer_email: 'rohan.photographer@example.com',
    photographer_name: 'Rohan Sharma',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sentEmailsLog.length = 0; // Clear in-memory email log
  });

  // ======================================================================
  // 1. RBAC & Authentication Checks (PRD Pages 18-19, 24, 30)
  // ======================================================================
  describe('RBAC & Authentication Checks', () => {
    it('rejects with 401 UNAUTHORIZED when no token is provided', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 FORBIDDEN when user has photographer role', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .send(validPayload);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  // ======================================================================
  // 2. Route Parameter & Request Body Validation (PRD Pages 18-19)
  // ======================================================================
  describe('Validation & Bad Request Handling', () => {
    it('rejects with 400 INVALID_EVENT_ID when eventId is not a number', async () => {
      const response = await request(app)
        .post('/api/admin/events/abc/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects with 400 INVALID_EVENT_ID when eventId is zero or negative', async () => {
      const response = await request(app)
        .post('/api/admin/events/0/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects with 400 VALIDATION_ERROR when invitation_html is missing', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send({
          landing_page_html: validPayload.landing_page_html,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toContain('invitation_html');
    });

    it('rejects with 400 VALIDATION_ERROR when invitation_html is empty string', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send({
          ...validPayload,
          invitation_html: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toContain('invitation_html');
    });

    it('rejects with 400 VALIDATION_ERROR when landing_page_html is missing', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send({
          invitation_html: validPayload.invitation_html,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toContain('landing_page_html');
    });

    it('rejects with 400 VALIDATION_ERROR when landing_page_html is empty string', async () => {
      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send({
          ...validPayload,
          landing_page_html: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.error).toContain('landing_page_html');
    });
  });

  // ======================================================================
  // 3. Event Existence & Status Verification (PRD Pages 18-19)
  // ======================================================================
  describe('Event Existence & State Machine Verification', () => {
    it('returns 404 EVENT_NOT_FOUND when event does not exist in database', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .post('/api/admin/events/999/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns 400 INVALID_EVENT_STATE when event status is already ready_for_upload', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ ...mockPendingEventRow, status: 'ready_for_upload' }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_STATE');
      expect(response.body.error).toContain('ready_for_upload');
    });

    it('returns 400 INVALID_EVENT_STATE when event status is already live', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ ...mockPendingEventRow, status: 'live' }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_STATE');
      expect(response.body.error).toContain('live');
    });
  });

  // ======================================================================
  // 4. Successful Mark Ready Flow (PRD Pages 18-19)
  // ======================================================================
  describe('Successful Transition Flow', () => {
    it('successfully transitions event to ready_for_upload, stores HTML, logs to admin_logs, and returns 200', async () => {
      // 1. SELECT query finds the pending event
      queryMock.mockResolvedValueOnce({
        rows: [mockPendingEventRow],
        rowCount: 1,
      } as any);

      // 2. UPDATE query updates event
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 42, status: 'ready_for_upload' }],
        rowCount: 1,
      } as any);

      // 3. INSERT query into admin_logs
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        event_id: 42,
        status: 'ready_for_upload',
      });

      // Verify DB queries
      expect(queryMock).toHaveBeenCalledTimes(3);

      // Verify SELECT query
      expect(queryMock.mock.calls[0]![0]).toContain('FROM events e');
      expect(queryMock.mock.calls[0]![1]).toEqual([42]);

      // Verify UPDATE query
      const updateSql = queryMock.mock.calls[1]![0];
      const updateParams = queryMock.mock.calls[1]![1] as any[];
      expect(updateSql).toContain('UPDATE events');
      expect(updateSql).toContain("status = 'ready_for_upload'");
      expect(updateSql).toContain('ready_at = CURRENT_TIMESTAMP');
      expect(updateParams[0]).toBe(validPayload.invitation_html);
      expect(updateParams[1]).toBe(validPayload.landing_page_html);
      expect(updateParams[2]).toBe(validPayload.admin_notes);
      expect(updateParams[3]).toBe(42);

      // Verify admin_logs INSERT query
      const logSql = queryMock.mock.calls[2]![0];
      const logParams = queryMock.mock.calls[2]![1] as any[];
      expect(logSql).toContain('INSERT INTO admin_logs');
      expect(logParams[0]).toBe(1); // adminId from token
      expect(logParams[1]).toBe('mark_ready');
      expect(logParams[2]).toBe('event');
      expect(logParams[3]).toBe(42);
      expect(logParams[4]).toBe(validPayload.admin_notes);

      // Verify photographer email dispatch
      expect(sentEmailsLog.length).toBe(1);
      const email = sentEmailsLog[0]!;
      expect(email.to).toBe('rohan.photographer@example.com');
      expect(email.subject).toContain('Album ready! Upload your photos');
      expect(email.subject).toContain('Aarav & Priya Wedding');
    });

    it('works without optional admin_notes and sets default audit reason', async () => {
      // 1. SELECT query
      queryMock.mockResolvedValueOnce({
        rows: [mockPendingEventRow],
        rowCount: 1,
      } as any);

      // 2. UPDATE query
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 42, status: 'ready_for_upload' }],
        rowCount: 1,
      } as any);

      // 3. INSERT query into admin_logs
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 2 }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send({
          invitation_html: validPayload.invitation_html,
          landing_page_html: validPayload.landing_page_html,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.event_id).toBe(42);
      expect(response.body.status).toBe('ready_for_upload');

      // Verify default admin_logs reason
      const logParams = queryMock.mock.calls[2]![1] as any[];
      expect(logParams[4]).toBe('Event pages designed and marked ready for upload');
    });

    it('returns 500 when database update fails', async () => {
      // 1. SELECT query succeeds
      queryMock.mockResolvedValueOnce({
        rows: [mockPendingEventRow],
        rowCount: 1,
      } as any);

      // 2. UPDATE query throws DB error
      queryMock.mockRejectedValueOnce(new Error('Database connection lost'));

      const response = await request(app)
        .post('/api/admin/events/42/mark-ready')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
