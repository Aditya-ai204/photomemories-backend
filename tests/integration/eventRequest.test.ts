import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';
import { decryptData } from '../../src/utils/crypto';

// Mock database query
vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

// Mock Razorpay SDK
const mockRazorpayOrdersCreate = vi.fn();
vi.mock('razorpay', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      orders: {
        create: mockRazorpayOrdersCreate,
      },
    })),
  };
});

describe('Event Request Endpoint Integration (POST /api/events/request)', () => {
  const queryMock = vi.mocked(db.query);

  const validEventPayload = {
    event_name: 'Aarav & Priya Wedding',
    couple_names: 'Aarav & Priya',
    event_date: '2024-12-15',
    theme: 'traditional',
    location: 'Delhi',
    client_email: 'client@example.com',
    client_phone: '9876543210',
    plan: 'pro',
    amount: 25000,
  };

  const photographerToken = signAccessToken({
    userId: 10,
    email: 'photographer@example.com',
    role: 'photographer',
  });

  const adminToken = signAccessToken({
    userId: 1,
    email: 'admin@photomemories.ai',
    role: 'admin',
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful Razorpay order response
    mockRazorpayOrdersCreate.mockResolvedValue({
      id: 'order_rzp_mock_123',
      entity: 'order',
      amount: 2500000,
      currency: 'INR',
      status: 'created',
      receipt: 'rcpt_evt_1',
    });
  });

  // ----------------------------------------------------------------------
  // 1. Successful Photographer Event Request (Req 1, 9, 10, 11, 12, 13)
  // ----------------------------------------------------------------------
  it('creates an event request successfully with 201 and PRD-specified response', async () => {
    // 1. Slug availability check -> available (count: 0)
    queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    // 2. Insert event query -> returns id 42
    queryMock.mockResolvedValueOnce({ rows: [{ id: 42 }] } as never);

    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send(validEventPayload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      event_id: 42,
      payment_url: 'https://checkout.razorpay.com/v1/orders/order_rzp_mock_123',
      plan: 'pro',
    });

    // Verify Razorpay order creation called with correct amount (in paise: 25,000 * 100 = 2,500,000)
    expect(mockRazorpayOrdersCreate).toHaveBeenCalledOnce();
    expect(mockRazorpayOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500000,
        currency: 'INR',
        notes: expect.objectContaining({
          photographer_id: 10,
          event_name: 'Aarav & Priya Wedding',
          slug: 'aarav-priya-2024',
        }),
      })
    );

    // Verify database query parameters
    expect(queryMock).toHaveBeenCalledTimes(2);
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall).toBeDefined();
    const insertSql = insertCall![0] as string;
    const insertParams = insertCall![1] as unknown[];

    expect(insertSql).toContain('INSERT INTO events');
    expect(insertParams[0]).toBe(10); // photographer_id
    expect(insertParams[1]).toBe('Aarav & Priya Wedding');
    expect(insertParams[2]).toBe('Aarav & Priya');
    expect(insertParams[3]).toBe('2024-12-15');
    expect(insertParams[4]).toBe('traditional');
    expect(insertParams[5]).toBe('Delhi');
    expect(insertParams[8]).toBe('pro'); // plan
    expect(insertParams[9]).toBe('pending'); // status
    expect(insertParams[10]).toBe('aarav-priya-2024'); // unique_slug
    expect(insertParams[12]).toBe(25000); // amount_paid
    expect(insertParams[13]).toBe('pending'); // payment_status
  });

  // ----------------------------------------------------------------------
  // 2. Encryption Verification at Rest (Req 7, 8)
  // ----------------------------------------------------------------------
  it('encrypts client_email and client_phone at rest before database insertion', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    queryMock.mockResolvedValueOnce({ rows: [{ id: 43 }] } as never);

    await request(app)
      .post('/api/events/request')
      .set('Authorization', `Bearer ${photographerToken}`)
      .send(validEventPayload);

    const insertCall = queryMock.mock.calls[1];
    const insertParams = insertCall![1] as string[];

    const storedEmailCipher = insertParams[6];
    const storedPhoneCipher = insertParams[7];

    expect(storedEmailCipher).toBeDefined();
    expect(storedPhoneCipher).toBeDefined();

    // Plaintext strings must never be stored directly in parameters
    expect(storedEmailCipher).not.toBe('client@example.com');
    expect(storedPhoneCipher).not.toBe('9876543210');

    // Must match PRD AES-256-GCM format: iv:authTag:encrypted
    expect(storedEmailCipher).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(storedPhoneCipher).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);

    // Decrypting with crypto utility must recover original plaintext
    expect(decryptData(storedEmailCipher!)).toBe('client@example.com');
    expect(decryptData(storedPhoneCipher!)).toBe('9876543210');
  });

  // ----------------------------------------------------------------------
  // 3. Authentication & Authorization (Req 2, 3)
  // ----------------------------------------------------------------------
  it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
    const res = await request(app)
      .post('/api/events/request')
      .send(validEventPayload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(queryMock).not.toHaveBeenCalled();
    expect(mockRazorpayOrdersCreate).not.toHaveBeenCalled();
  });

  it('rejects non-photographer role (e.g. admin) with 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`])
      .send(validEventPayload);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(queryMock).not.toHaveBeenCalled();
    expect(mockRazorpayOrdersCreate).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------
  // 4. Input & Schema Validation (Req 4, 5)
  // ----------------------------------------------------------------------
  it('rejects request when required fields are missing with 400 VALIDATION_ERROR', async () => {
    const incompletePayload = {
      event_name: 'Wedding',
      // couple_names missing
      event_date: '2024-12-15',
      // theme missing
      location: 'Delhi',
      client_email: 'client@example.com',
      client_phone: '9876543210',
      plan: 'pro',
      amount: 25000,
    };

    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send(incompletePayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('couple_names');
    expect(res.body.error).toContain('theme');
  });

  it('rejects invalid email format with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send({ ...validEventPayload, client_email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('client_email');
  });

  it('rejects invalid plan with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send({ ...validEventPayload, plan: 'enterprise' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('plan must be one of: base, medium, pro');
  });

  // ----------------------------------------------------------------------
  // 5. Plan Amount Validation (Req 6)
  // ----------------------------------------------------------------------
  it('rejects request when amount does not match configured plan price with 400 INVALID_AMOUNT', async () => {
    // Pro plan default is 25000; passing 10000 must be rejected
    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send({ ...validEventPayload, amount: 10000 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_AMOUNT');
    expect(res.body.error).toContain('Invalid payment amount for plan "pro"');
    expect(queryMock).not.toHaveBeenCalled();
    expect(mockRazorpayOrdersCreate).not.toHaveBeenCalled();
  });

  it('creates an event successfully with base plan and configured base price', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    queryMock.mockResolvedValueOnce({ rows: [{ id: 45 }] } as never);

    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send({
        ...validEventPayload,
        plan: 'base',
        amount: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body.plan).toBe('base');
    expect(res.body.event_id).toBe(45);
    expect(mockRazorpayOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500000, // 5,000 * 100 paise
      })
    );
  });

  // ----------------------------------------------------------------------
  // 6. External Gateway & Database Failures (Req 14, 15)
  // ----------------------------------------------------------------------
  it('handles Razorpay API failure cleanly and returns 502 PAYMENT_GATEWAY_ERROR', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // Slug available
    mockRazorpayOrdersCreate.mockRejectedValueOnce(new Error('Razorpay network timeout'));

    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send(validEventPayload);

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_GATEWAY_ERROR');
    expect(res.body.error).toContain('Razorpay network timeout');
  });

  it('handles database failure cleanly and returns 500 error', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never); // Slug available
    queryMock.mockRejectedValueOnce(new Error('Connection terminated unexpectedly')); // DB insert fails

    const res = await request(app)
      .post('/api/events/request')
      .set('Cookie', [`${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`])
      .send(validEventPayload);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
