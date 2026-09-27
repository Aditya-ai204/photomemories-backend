import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { env } from '../../src/config/env';
import { generateRazorpaySignature } from '../../src/services/paymentService';
import * as emailService from '../../src/services/emailService';

// Mock database query
vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

describe('Payment Webhook Integration (POST /api/payments/webhook)', () => {
  const queryMock = vi.mocked(db.query);

  const mockPhotographer = {
    id: 10,
    name: 'Rohan Sharma',
    email: 'rohan.photographer@example.com',
  };

  const mockPendingEvent = {
    id: 42,
    event_name: 'Aarav & Priya Wedding',
    unique_slug: 'aarav-priya-royal-palace-2024',
    plan: 'pro',
    amount_paid: 25000,
    payment_status: 'pending',
    photographer_id: mockPhotographer.id,
    photographer_name: mockPhotographer.name,
    photographer_email: mockPhotographer.email,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------------
  // 1. Signature Verification Security
  // ----------------------------------------------------------------------
  describe('Signature Verification & Security', () => {
    it('rejects requests missing x-razorpay-signature header with 400 Bad Request', async () => {
      const payload = JSON.stringify({
        event: 'order.paid',
        payload: {
          payment: {
            entity: {
              id: 'pay_123',
              notes: { slug: 'aarav-priya-royal-palace-2024' },
            },
          },
        },
      });

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_SIGNATURE');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects requests with empty/whitespace signature header with 400 Bad Request', async () => {
      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', '   ')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ notes: { slug: 'test' } }));

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_SIGNATURE');
    });

    it('rejects requests with invalid / tampered HMAC signature with 400 Bad Request', async () => {
      const payload = JSON.stringify({
        event: 'order.paid',
        notes: { slug: 'aarav-priya-royal-palace-2024' },
      });

      const forgedSignature = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', forgedSignature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_SIGNATURE');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('never leaks RAZORPAY_KEY_SECRET in error responses or headers', async () => {
      const payload = JSON.stringify({ notes: { slug: 'test' } });
      const badSig = 'invalid-hex-digest';

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', badSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      const resString = JSON.stringify(response.body);
      expect(resString).not.toContain(env.RAZORPAY_KEY_SECRET);
      expect(resString).not.toContain(env.RAZORPAY_KEY_ID);
    });

    it('works as a public server-to-server callback without requiring JWT token cookies', async () => {
      // Setup DB mocks for a valid call
      queryMock.mockResolvedValueOnce({ rows: [mockPendingEvent], rowCount: 1 } as any);
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const payload = JSON.stringify({
        notes: { slug: mockPendingEvent.unique_slug },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      // Note: No Cookie header, no Authorization header
      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ----------------------------------------------------------------------
  // 2. Payload Validation & Event Lookup
  // ----------------------------------------------------------------------
  describe('Payload Validation & Event Resolution', () => {
    it('rejects payload missing event identifier (both slug and event_id missing) with 400', async () => {
      const payload = JSON.stringify({
        event: 'order.paid',
        notes: {}, // No slug, no event_id
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_EVENT_REFERENCE');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('returns 404 Not Found if event does not exist in database', async () => {
      // Mock DB: event not found
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const payload = JSON.stringify({
        notes: { slug: 'non-existent-event-slug' },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EVENT_NOT_FOUND');
    });
  });

  // ----------------------------------------------------------------------
  // 3. Successful Webhook Processing & State Transitions
  // ----------------------------------------------------------------------
  describe('Successful Webhook Processing', () => {
    it('updates event payment_status to completed using slug lookup', async () => {
      // 1. SELECT event
      queryMock.mockResolvedValueOnce({ rows: [mockPendingEvent], rowCount: 1 } as any);
      // 2. UPDATE event
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const emailSpy = vi.spyOn(emailService, 'sendPhotographerPaymentConfirmationEmail');
      const adminEmailSpy = vi.spyOn(emailService, 'sendAdminPaymentNotificationEmail');

      const payload = JSON.stringify({
        event: 'payment.captured',
        notes: { slug: 'aarav-priya-royal-palace-2024' },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.payment_status).toBe('completed');
      expect(response.body.event_id).toBe(mockPendingEvent.id);

      // Verify SELECT query
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['aarav-priya-royal-palace-2024']
      );

      // Verify UPDATE query
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("payment_status = 'completed'"),
        [mockPendingEvent.amount_paid, mockPendingEvent.id]
      );

      // Verify emails were dispatched
      expect(emailSpy).toHaveBeenCalledWith(
        mockPhotographer.email,
        mockPhotographer.name,
        mockPendingEvent.event_name
      );
      expect(adminEmailSpy).toHaveBeenCalledWith(
        env.ADMIN_EMAIL,
        mockPhotographer.name,
        mockPhotographer.email,
        mockPendingEvent.event_name,
        mockPendingEvent.id,
        mockPendingEvent.plan,
        mockPendingEvent.amount_paid
      );
    });

    it('updates event payment_status using event_id lookup', async () => {
      // 1. SELECT event by id
      queryMock.mockResolvedValueOnce({ rows: [mockPendingEvent], rowCount: 1 } as any);
      // 2. UPDATE event
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const payload = JSON.stringify({
        event_id: 42,
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.event_id).toBe(42);
      expect(response.body.payment_status).toBe('completed');

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('WHERE e.id = $1'),
        [42]
      );
    });

    it('handles realistic nested Razorpay webhook payload and converts paise to rupees', async () => {
      // 1. SELECT event
      queryMock.mockResolvedValueOnce({ rows: [mockPendingEvent], rowCount: 1 } as any);
      // 2. UPDATE event
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const razorpayWebhookPayload = JSON.stringify({
        entity: 'event',
        account_id: 'acc_test123',
        event: 'order.paid',
        contains: ['payment', 'order'],
        payload: {
          payment: {
            entity: {
              id: 'pay_ABC123456789',
              order_id: 'order_XYZ987654321',
              amount: 2500000, // 25,000 INR in paise
              currency: 'INR',
              status: 'captured',
              notes: {
                slug: 'aarav-priya-royal-palace-2024',
                event_name: 'Aarav & Priya Wedding',
                photographer_id: 10,
              },
            },
          },
          order: {
            entity: {
              id: 'order_XYZ987654321',
              amount: 2500000,
              amount_paid: 2500000,
              status: 'paid',
            },
          },
        },
      });

      const validSig = generateRazorpaySignature(razorpayWebhookPayload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(razorpayWebhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify that 2500000 paise was converted to 25000 rupees in update
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("payment_status = 'completed'"),
        [25000, 42]
      );
    });
  });

  // ----------------------------------------------------------------------
  // 4. Idempotency & Duplicate Webhooks
  // ----------------------------------------------------------------------
  describe('Idempotency on Duplicate Webhook Deliveries', () => {
    it('returns 200 already_processed without repeating DB update or sending duplicate emails', async () => {
      const alreadyCompletedEvent = {
        ...mockPendingEvent,
        payment_status: 'completed',
      };

      // 1. SELECT returns already completed event
      queryMock.mockResolvedValueOnce({ rows: [alreadyCompletedEvent], rowCount: 1 } as any);

      const emailSpy = vi.spyOn(emailService, 'sendPhotographerPaymentConfirmationEmail');
      const adminEmailSpy = vi.spyOn(emailService, 'sendAdminPaymentNotificationEmail');

      const payload = JSON.stringify({
        notes: { slug: 'aarav-priya-royal-palace-2024' },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.already_processed).toBe(true);

      // Verify NO UPDATE query was made (only the initial SELECT)
      expect(queryMock).toHaveBeenCalledTimes(1);

      // Verify NO duplicate emails were sent
      expect(emailSpy).not.toHaveBeenCalled();
      expect(adminEmailSpy).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  // 5. Resilience & Error Handling
  // ----------------------------------------------------------------------
  describe('Error Handling & Resilience', () => {
    it('remains successful and updates DB even if email dispatch fails (non-blocking)', async () => {
      // 1. SELECT event
      queryMock.mockResolvedValueOnce({ rows: [mockPendingEvent], rowCount: 1 } as any);
      // 2. UPDATE event
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      // Force email services to reject
      vi.spyOn(emailService, 'sendPhotographerPaymentConfirmationEmail').mockRejectedValueOnce(
        new Error('SMTP connection timed out')
      );
      vi.spyOn(emailService, 'sendAdminPaymentNotificationEmail').mockRejectedValueOnce(
        new Error('SMTP rate limit exceeded')
      );

      const payload = JSON.stringify({
        notes: { slug: 'aarav-priya-royal-palace-2024' },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      // Webhook should STILL succeed with 200 because DB was updated
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.payment_status).toBe('completed');
    });

    it('delegates to global error handler on unexpected database failure', async () => {
      queryMock.mockRejectedValueOnce(new Error('PostgreSQL connection dropped'));

      const payload = JSON.stringify({
        notes: { slug: 'aarav-priya-royal-palace-2024' },
      });
      const validSig = generateRazorpaySignature(payload, env.RAZORPAY_KEY_SECRET);

      const response = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', validSig)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
