import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import {
  isValidPlan,
  validatePlan,
  configurePlanPricing,
  resetPlanPricing,
  getPlanPrice,
  getAllPlanPrices,
  validatePlanAmount,
  convertAmountToSmallestUnit,
  getRazorpayClient,
  createRazorpayOrder,
  generateRazorpaySignature,
  verifyRazorpaySignature,
  verifyRazorpayPaymentSignature,
  DEFAULT_PLAN_PRICING,
  PlanType,
} from '../../src/services/paymentService';
import { AppError } from '../../src/types';

describe('Payment Service (Razorpay Integration & Configurable Pricing)', () => {
  beforeEach(() => {
    resetPlanPricing();
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------------
  // 1. Plan Validation
  // ----------------------------------------------------------------------
  describe('Plan Validation (Requirement 1 & 2)', () => {
    it('validates and normalizes valid plans: base, medium, pro', () => {
      expect(isValidPlan('base')).toBe(true);
      expect(isValidPlan('medium')).toBe(true);
      expect(isValidPlan('pro')).toBe(true);

      expect(validatePlan('base')).toBe('base');
      expect(validatePlan('medium')).toBe('medium');
      expect(validatePlan('pro')).toBe('pro');

      // Case-insensitivity and whitespace trimming
      expect(validatePlan('  BASE  ')).toBe('base');
      expect(validatePlan('Medium')).toBe('medium');
      expect(validatePlan('PRO')).toBe('pro');
    });

    it('rejects invalid plan strings with 400 INVALID_PLAN', () => {
      expect(isValidPlan('enterprise')).toBe(false);
      expect(isValidPlan('free')).toBe(false);
      expect(isValidPlan('')).toBe(false);
      expect(isValidPlan(null)).toBe(false);
      expect(isValidPlan(undefined)).toBe(false);
      expect(isValidPlan(123)).toBe(false);

      expect(() => validatePlan('enterprise')).toThrowError(AppError);
      expect(() => validatePlan('enterprise')).toThrowError(/Invalid subscription plan/);

      try {
        validatePlan('ultra');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('INVALID_PLAN');
      }
    });
  });

  // ----------------------------------------------------------------------
  // 2. Configurable Plan Pricing (ADR-002)
  // ----------------------------------------------------------------------
  describe('Configurable Plan Pricing (Requirement 3 & 5)', () => {
    it('provides PRD Page 13 illustrative example of ₹25,000 for pro as default', () => {
      expect(DEFAULT_PLAN_PRICING.pro).toBe(25000);
      expect(getPlanPrice('pro')).toBe(25000);
    });

    it('provides sensible default pricing for base and medium', () => {
      expect(getPlanPrice('base')).toBe(5000);
      expect(getPlanPrice('medium')).toBe(15000);
      expect(getAllPlanPrices()).toEqual({
        base: 5000,
        medium: 15000,
        pro: 25000,
      });
    });

    it('allows runtime reconfiguration of plan pricing per ADR-002', () => {
      configurePlanPricing({
        base: 7500,
        medium: 17500,
      });

      expect(getPlanPrice('base')).toBe(7500);
      expect(getPlanPrice('medium')).toBe(17500);
      // Pro remains untouched
      expect(getPlanPrice('pro')).toBe(25000);

      // Reset restores defaults
      resetPlanPricing();
      expect(getPlanPrice('base')).toBe(5000);
      expect(getPlanPrice('medium')).toBe(15000);
    });

    it('supports override pricing passed directly to getPlanPrice and getAllPlanPrices', () => {
      const overrides: Partial<Record<PlanType, number>> = {
        base: 9999,
        pro: 30000,
      };

      expect(getPlanPrice('base', overrides)).toBe(9999);
      expect(getPlanPrice('medium', overrides)).toBe(15000);
      expect(getPlanPrice('pro', overrides)).toBe(30000);

      const all = getAllPlanPrices(overrides);
      expect(all.base).toBe(9999);
      expect(all.medium).toBe(15000);
      expect(all.pro).toBe(30000);
    });

    it('rejects invalid pricing configuration (negative, zero, or non-finite values)', () => {
      expect(() => configurePlanPricing({ base: -100 })).toThrowError(AppError);
      expect(() => configurePlanPricing({ base: 0 })).toThrowError(AppError);
      expect(() => configurePlanPricing({ medium: NaN })).toThrowError(AppError);
      expect(() => configurePlanPricing({ pro: Infinity })).toThrowError(AppError);
    });

    it('validates requested amount against configured plan price', () => {
      // Correct amount matches configured price
      expect(() => validatePlanAmount('pro', 25000)).not.toThrow();
      expect(() => validatePlanAmount('base', 5000)).not.toThrow();

      // Mismatched amount throws 400 INVALID_AMOUNT
      expect(() => validatePlanAmount('pro', 10000)).toThrowError(AppError);
      try {
        validatePlanAmount('pro', 10000);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('INVALID_AMOUNT');
      }

      // Non-positive or non-finite amount throws 400 INVALID_AMOUNT
      expect(() => validatePlanAmount('base', 0)).toThrowError(AppError);
      expect(() => validatePlanAmount('base', -5000)).toThrowError(AppError);
      expect(() => validatePlanAmount('base', NaN)).toThrowError(AppError);
    });
  });

  // ----------------------------------------------------------------------
  // 3. Amount Conversion (Subunits / Paise)
  // ----------------------------------------------------------------------
  describe('Amount Conversion to Smallest Unit (Requirement 4)', () => {
    it('converts INR amounts into paise correctly (1 INR = 100 paise)', () => {
      expect(convertAmountToSmallestUnit(25000, 'INR')).toBe(2500000);
      expect(convertAmountToSmallestUnit(5000, 'INR')).toBe(500000);
      expect(convertAmountToSmallestUnit(1, 'INR')).toBe(100);
      expect(convertAmountToSmallestUnit(99.50, 'INR')).toBe(9950);
    });

    it('rejects non-positive, zero, NaN, or non-finite amounts with 400 INVALID_AMOUNT', () => {
      expect(() => convertAmountToSmallestUnit(0)).toThrowError(AppError);
      expect(() => convertAmountToSmallestUnit(-100)).toThrowError(AppError);
      expect(() => convertAmountToSmallestUnit(NaN)).toThrowError(AppError);
      expect(() => convertAmountToSmallestUnit(Infinity)).toThrowError(AppError);
      expect(() => convertAmountToSmallestUnit('25000' as any)).toThrowError(AppError);
    });
  });

  // ----------------------------------------------------------------------
  // 4. Razorpay Client & Credentials Validation
  // ----------------------------------------------------------------------
  describe('Razorpay Client & Credentials (Requirement 8 & 9)', () => {
    it('instantiates Razorpay client with valid credentials', () => {
      const client = getRazorpayClient({
        keyId: 'rzp_test_valid_key',
        keySecret: 'rzp_test_valid_secret',
      });
      expect(client).toBeInstanceOf(Razorpay);
    });

    it('rejects missing or empty RAZORPAY_KEY_ID with 500 PAYMENT_CONFIG_ERROR', () => {
      expect(() =>
        getRazorpayClient({ keyId: '', keySecret: 'secret_123' })
      ).toThrowError(AppError);

      try {
        getRazorpayClient({ keyId: '   ', keySecret: 'secret_123' });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
        expect((err as AppError).code).toBe('PAYMENT_CONFIG_ERROR');
      }
    });

    it('rejects missing or empty RAZORPAY_KEY_SECRET with 500 PAYMENT_CONFIG_ERROR', () => {
      expect(() =>
        getRazorpayClient({ keyId: 'key_123', keySecret: '' })
      ).toThrowError(AppError);

      try {
        getRazorpayClient({ keyId: 'key_123', keySecret: '   ' });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
        expect((err as AppError).code).toBe('PAYMENT_CONFIG_ERROR');
      }
    });
  });

  // ----------------------------------------------------------------------
  // 5. Razorpay Order Creation
  // ----------------------------------------------------------------------
  describe('Razorpay Order Creation (Requirement 6 & 7)', () => {
    it('creates an order successfully through a mocked Razorpay client', async () => {
      const mockOrderResponse = {
        id: 'order_test_123456',
        entity: 'order',
        amount: 2500000,
        amount_paid: 0,
        amount_due: 2500000,
        currency: 'INR',
        receipt: 'rcpt_event_42',
        status: 'created',
        attempts: 0,
        notes: { plan: 'pro' },
        created_at: Math.floor(Date.now() / 1000),
      };

      const mockCreate = vi.fn().mockResolvedValue(mockOrderResponse);
      const mockClient = {
        orders: {
          create: mockCreate,
        },
      } as unknown as Razorpay;

      const result = await createRazorpayOrder({
        plan: 'pro',
        amount: 25000,
        receipt: 'rcpt_event_42',
        notes: { couple: 'Aarav & Priya' },
        client: mockClient,
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        amount: 2500000,
        currency: 'INR',
        receipt: 'rcpt_event_42',
        notes: {
          plan: 'pro',
          couple: 'Aarav & Priya',
        },
      });

      expect(result).toEqual({
        order_id: 'order_test_123456',
        amount: 2500000,
        amount_rupees: 25000,
        currency: 'INR',
        plan: 'pro',
        status: 'created',
        receipt: 'rcpt_event_42',
        payment_url: 'https://checkout.razorpay.com/v1/orders/order_test_123456',
      });
    });

    it('infers amount automatically from configured plan price when amount is omitted', async () => {
      const mockOrderResponse = {
        id: 'order_base_987654',
        amount: 500000,
        currency: 'INR',
        status: 'created',
        receipt: 'rcpt_auto',
      };

      const mockCreate = vi.fn().mockResolvedValue(mockOrderResponse);
      const mockClient = {
        orders: {
          create: mockCreate,
        },
      } as unknown as Razorpay;

      const result = await createRazorpayOrder({
        plan: 'base',
        client: mockClient,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500000,
          currency: 'INR',
        })
      );
      expect(result.amount_rupees).toBe(5000);
      expect(result.amount).toBe(500000);
      expect(result.plan).toBe('base');
    });

    it('handles Razorpay API errors cleanly and throws 502 PAYMENT_GATEWAY_ERROR', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('Gateway connection timeout'));
      const mockClient = {
        orders: {
          create: mockCreate,
        },
      } as unknown as Razorpay;

      await expect(
        createRazorpayOrder({
          plan: 'pro',
          client: mockClient,
        })
      ).rejects.toThrowError(AppError);

      try {
        await createRazorpayOrder({
          plan: 'pro',
          client: mockClient,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(502);
        expect((err as AppError).code).toBe('PAYMENT_GATEWAY_ERROR');
        expect((err as AppError).message).toContain('Gateway connection timeout');
      }
    });

    it('rejects order creation if specified amount does not match plan price', async () => {
      const mockClient = {
        orders: {
          create: vi.fn(),
        },
      } as unknown as Razorpay;

      await expect(
        createRazorpayOrder({
          plan: 'pro',
          amount: 19999, // Mismatched
          client: mockClient,
        })
      ).rejects.toThrowError(AppError);
    });
  });

  // ----------------------------------------------------------------------
  // 6. HMAC-SHA256 Signature Generation & Verification
  // ----------------------------------------------------------------------
  describe('HMAC-SHA256 Signature Verification (Requirement 10–15)', () => {
    const testSecret = 'secret_test_key_hmac_256_verification_string';
    const payload = JSON.stringify({
      entity: 'event',
      event: 'order.paid',
      contains: ['payment'],
      payload: { payment: { entity: { id: 'pay_test_123', amount: 2500000 } } },
    });

    it('generates a valid 64-character hex HMAC-SHA256 signature', () => {
      const signature = generateRazorpaySignature(payload, testSecret);
      expect(signature).toMatch(/^[0-9a-f]{64}$/);

      // Verify manually using node:crypto
      const manualHmac = crypto
        .createHmac('sha256', testSecret)
        .update(payload)
        .digest('hex');
      expect(signature).toBe(manualHmac);
    });

    it('accepts valid signatures matching payload and secret', () => {
      const validSignature = generateRazorpaySignature(payload, testSecret);
      const isVerified = verifyRazorpaySignature(payload, validSignature, testSecret);
      expect(isVerified).toBe(true);
    });

    it('rejects invalid/forged signatures', () => {
      const forgedSignature = 'a'.repeat(64);
      const isVerified = verifyRazorpaySignature(payload, forgedSignature, testSecret);
      expect(isVerified).toBe(false);
    });

    it('rejects signatures when payload content is tampered', () => {
      const validSignature = generateRazorpaySignature(payload, testSecret);
      const tamperedPayload = payload.replace('2500000', '1000000');
      const isVerified = verifyRazorpaySignature(tamperedPayload, validSignature, testSecret);
      expect(isVerified).toBe(false);
    });

    it('rejects signatures generated with a different secret', () => {
      const wrongSecret = 'another_unauthorized_key_secret_string';
      const signatureFromOtherSecret = generateRazorpaySignature(payload, wrongSecret);
      const isVerified = verifyRazorpaySignature(payload, signatureFromOtherSecret, testSecret);
      expect(isVerified).toBe(false);
    });

    it('safely rejects malformed, non-hex, or bad length signatures without throwing', () => {
      expect(verifyRazorpaySignature(payload, 'not-a-valid-hex-signature', testSecret)).toBe(false);
      expect(verifyRazorpaySignature(payload, 'abc123', testSecret)).toBe(false);
      expect(verifyRazorpaySignature(payload, '', testSecret)).toBe(false);
      expect(verifyRazorpaySignature(payload, null as any, testSecret)).toBe(false);
      expect(verifyRazorpaySignature(payload, undefined as any, testSecret)).toBe(false);
      expect(verifyRazorpaySignature(null as any, 'valid_hex_64', testSecret)).toBe(false);
      expect(verifyRazorpaySignature(undefined as any, 'valid_hex_64', testSecret)).toBe(false);
    });

    it('verifies payment checkout callback signatures: order_id|payment_id', () => {
      const orderId = 'order_9A33XWu170gUtm';
      const paymentId = 'pay_29MoEhaboh72Dm';
      const callbackSignature = generateRazorpaySignature(`${orderId}|${paymentId}`, testSecret);

      const isValid = verifyRazorpayPaymentSignature(orderId, paymentId, callbackSignature, testSecret);
      expect(isValid).toBe(true);

      const isInvalid = verifyRazorpayPaymentSignature(orderId, 'pay_forged_999', callbackSignature, testSecret);
      expect(isInvalid).toBe(false);
    });

    it('throws PAYMENT_CONFIG_ERROR if key secret is missing when verifying or generating signature', () => {
      expect(() => generateRazorpaySignature('payload', '')).toThrowError(AppError);
      expect(() => generateRazorpaySignature('payload', '   ')).toThrowError(AppError);
      expect(() => verifyRazorpaySignature('payload', 'sig', '')).toThrowError(AppError);
    });
  });

  // ----------------------------------------------------------------------
  // 7. Security: Zero Secret Leakage (Requirement 16)
  // ----------------------------------------------------------------------
  describe('Security & Zero Credential Leakage (Requirement 16)', () => {
    it('never leaks secret in thrown error messages during order creation', async () => {
      const sensitiveSecret = 'SUPER_SECRET_KEY_THAT_MUST_NEVER_BE_EXPOSED';
      const mockCreate = vi.fn().mockRejectedValue(
        new Error(`Failed to authenticate with secret ${sensitiveSecret}`)
      );
      const mockClient = {
        orders: {
          create: mockCreate,
        },
      } as unknown as Razorpay;

      try {
        await createRazorpayOrder({
          plan: 'pro',
          client: mockClient,
        });
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveSecret);
      }
    });

    it('never leaks secret in signature verification errors', () => {
      const sensitiveSecret = 'VERY_SECRET_KEY_12345';
      try {
        generateRazorpaySignature(123 as any, sensitiveSecret);
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveSecret);
      }
    });
  });
});
