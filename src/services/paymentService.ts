import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env';
import { AppError } from '../types';
import { logger } from '../utils/logger';

/**
 * Authoritative Payment Service (Razorpay Integration)
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 7-8, 12-13, 27-29)
 * Architecture Decision: ADR-002 (Configurable Plan Pricing Matrix) & ADR-004 (Razorpay Focus)
 * 
 * Rules:
 * - Plans: 'base' | 'medium' | 'pro'
 * - Pricing: Configurable pricing model. The PRD specifies an illustrative example of ₹25,000 for Pro.
 *   Base and Medium pricing are configurable and not hardcoded as ₹25,000.
 * - Currency: INR (Razorpay amounts in currency subunits: paise = INR * 100).
 * - HMAC-SHA256 signature verification using RAZORPAY_KEY_SECRET with constant-time comparison.
 * - Strict credential isolation: never log or expose key secrets.
 */

export type PlanType = 'base' | 'medium' | 'pro';

export const VALID_PLANS: readonly PlanType[] = ['base', 'medium', 'pro'] as const;

/**
 * Sensible default pricing structure in INR.
 * PRD Page 13 explicitly provides ₹25,000 as an illustrative example for 'pro'.
 * 'base' and 'medium' prices are configurable per ADR-002.
 */
export const DEFAULT_PLAN_PRICING: Record<PlanType, number> = {
  base: 5000,
  medium: 15000,
  pro: 25000, // PRD Page 13 illustrative example
};

// In-memory runtime pricing configuration
let activePlanPricing: Record<PlanType, number> = { ...DEFAULT_PLAN_PRICING };

/**
 * Validates whether an input is a recognized PlanType.
 */
export function isValidPlan(plan: unknown): plan is PlanType {
  if (typeof plan !== 'string') {
    return false;
  }
  return VALID_PLANS.includes(plan.trim().toLowerCase() as PlanType);
}

/**
 * Validates and normalizes plan input. Throws AppError if invalid.
 */
export function validatePlan(plan: unknown): PlanType {
  if (!isValidPlan(plan)) {
    throw new AppError(
      `Invalid subscription plan: "${String(plan)}". Valid plans are: ${VALID_PLANS.join(', ')}`,
      400,
      'INVALID_PLAN'
    );
  }
  return (plan as string).trim().toLowerCase() as PlanType;
}

/**
 * Updates runtime pricing configuration for plans.
 * Each supplied price must be a positive finite number.
 */
export function configurePlanPricing(pricing: Partial<Record<PlanType, number>>): void {
  for (const [planKey, price] of Object.entries(pricing)) {
    if (!isValidPlan(planKey)) {
      throw new AppError(`Cannot configure pricing for invalid plan: "${planKey}"`, 400, 'INVALID_PLAN');
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new AppError(
        `Configured price for plan "${planKey}" must be a positive finite number. Received: ${price}`,
        400,
        'INVALID_PRICING_CONFIG'
      );
    }
  }

  activePlanPricing = {
    ...activePlanPricing,
    ...pricing,
  };
}

/**
 * Resets runtime pricing configuration back to defaults.
 */
export function resetPlanPricing(): void {
  activePlanPricing = { ...DEFAULT_PLAN_PRICING };
}

/**
 * Gets the resolved price for a given plan in INR.
 */
export function getPlanPrice(
  plan: PlanType,
  overridePricing?: Partial<Record<PlanType, number>>
): number {
  const resolvedPrice = overridePricing?.[plan] ?? activePlanPricing[plan];
  if (typeof resolvedPrice !== 'number' || !Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
    throw new AppError(`No valid price configured for plan "${plan}"`, 500, 'PAYMENT_CONFIG_ERROR');
  }
  return resolvedPrice;
}

/**
 * Returns a copy of the active pricing map for all plans.
 */
export function getAllPlanPrices(
  overridePricing?: Partial<Record<PlanType, number>>
): Record<PlanType, number> {
  return {
    base: getPlanPrice('base', overridePricing),
    medium: getPlanPrice('medium', overridePricing),
    pro: getPlanPrice('pro', overridePricing),
  };
}

/**
 * Validates that a requested amount matches the configured price for a given plan.
 */
export function validatePlanAmount(
  plan: PlanType,
  amount: number,
  overridePricing?: Partial<Record<PlanType, number>>
): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || isNaN(amount) || amount <= 0) {
    throw new AppError(
      `Payment amount must be a positive finite number. Received: ${amount}`,
      400,
      'INVALID_AMOUNT'
    );
  }

  const expectedPrice = getPlanPrice(plan, overridePricing);
  if (amount !== expectedPrice) {
    throw new AppError(
      `Invalid payment amount for plan "${plan}". Expected ₹${expectedPrice}, received ₹${amount}`,
      400,
      'INVALID_AMOUNT'
    );
  }
}

/**
 * Converts an amount in currency major units (e.g., INR) to smallest currency units (paise).
 * Razorpay expects amount in paise (1 INR = 100 paise).
 */
export function convertAmountToSmallestUnit(amount: number, currency = 'INR'): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || isNaN(amount) || amount <= 0) {
    throw new AppError(
      `Payment amount must be a positive finite number. Received: ${amount}`,
      400,
      'INVALID_AMOUNT'
    );
  }

  const upperCurrency = currency.toUpperCase();
  if (upperCurrency === 'INR') {
    return Math.round(amount * 100);
  }

  // Default to 100 subunits for standard decimal currencies
  return Math.round(amount * 100);
}

/**
 * Options for instantiating the Razorpay client.
 */
export interface RazorpayClientConfig {
  keyId?: string;
  keySecret?: string;
}

/**
 * Instantiates a Razorpay client instance.
 * Throws AppError if credentials are not configured.
 */
export function getRazorpayClient(config?: RazorpayClientConfig): Razorpay {
  const key_id = config?.keyId ?? env.RAZORPAY_KEY_ID;
  const key_secret = config?.keySecret ?? env.RAZORPAY_KEY_SECRET;

  if (!key_id || typeof key_id !== 'string' || key_id.trim() === '') {
    throw new AppError(
      'Razorpay credentials are not configured: missing RAZORPAY_KEY_ID',
      500,
      'PAYMENT_CONFIG_ERROR'
    );
  }

  if (!key_secret || typeof key_secret !== 'string' || key_secret.trim() === '') {
    throw new AppError(
      'Razorpay credentials are not configured: missing RAZORPAY_KEY_SECRET',
      500,
      'PAYMENT_CONFIG_ERROR'
    );
  }

  return new Razorpay({
    key_id: key_id.trim(),
    key_secret: key_secret.trim(),
  });
}

/**
 * Parameters for creating a Razorpay order.
 */
export interface CreateRazorpayOrderOptions {
  plan: PlanType | string;
  amount?: number; // In INR; if provided, validated against plan price; if omitted, resolved from plan
  currency?: string; // Default: 'INR'
  receipt?: string;
  notes?: Record<string, string | number>;
  client?: Razorpay; // Dependency injection for testing/mocking
}

/**
 * Result structure returned after successful Razorpay order creation.
 */
export interface RazorpayOrderResult {
  order_id: string;
  amount: number; // In smallest unit (paise)
  amount_rupees: number; // In major unit (INR)
  currency: string;
  plan: PlanType;
  status: string;
  receipt?: string;
  payment_url: string;
}

/**
 * Sanitizes payment error messages to prevent credential or secret leakage.
 */
export function sanitizePaymentErrorMessage(
  rawMessage: unknown,
  customSecrets: string[] = []
): string {
  if (typeof rawMessage !== 'string') {
    return 'Razorpay order creation failed';
  }

  let sanitized = rawMessage;

  // Redact known configured secrets
  const secrets = [
    env.RAZORPAY_KEY_SECRET,
    env.RAZORPAY_KEY_ID,
    ...customSecrets,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));

  for (const s of secrets) {
    sanitized = sanitized.split(s).join('[REDACTED_SECRET]');
  }

  // Redact Razorpay key IDs
  sanitized = sanitized.replace(/rzp_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');

  // Redact patterns like "secret <val>", "key: <val>", "token=<val>"
  sanitized = sanitized.replace(
    /(?:secret|key|password|token)[\s:=]+([^\s,;]+)/gi,
    (match, captured) => match.replace(captured, '[REDACTED_SECRET]')
  );

  return sanitized;
}

/**
 * Creates a Razorpay payment order for an event request.
 * PRD Page 13:
 * - Validate input & plan amount
 * - Create Razorpay order/payment intent
 * - Return { event_id, payment_url, ... }
 */
export async function createRazorpayOrder(
  options: CreateRazorpayOrderOptions
): Promise<RazorpayOrderResult> {
  const plan = validatePlan(options.plan);
  const expectedPrice = getPlanPrice(plan);

  if (options.amount !== undefined) {
    validatePlanAmount(plan, options.amount);
  }

  const amountRupees = options.amount ?? expectedPrice;
  const currency = (options.currency || 'INR').toUpperCase();
  const amountInPaise = convertAmountToSmallestUnit(amountRupees, currency);

  const client = options.client || getRazorpayClient();

  try {
    const orderPayload = {
      amount: amountInPaise,
      currency,
      receipt: options.receipt || `order_rcpt_${Date.now()}`,
      notes: {
        plan,
        ...(options.notes || {}),
      },
    };

    // Razorpay orders.create API call
    const order = await client.orders.create(orderPayload as any);

    if (!order || !order.id) {
      throw new Error('Razorpay API did not return a valid order ID');
    }

    logger.info('Razorpay order created successfully', {
      order_id: order.id,
      plan,
      amount_rupees: amountRupees,
      currency,
      status: order.status,
    });

    return {
      order_id: order.id,
      amount: Number(order.amount),
      amount_rupees: amountRupees,
      currency: order.currency,
      plan,
      status: order.status,
      receipt: order.receipt ? String(order.receipt) : undefined,
      payment_url: `https://checkout.razorpay.com/v1/orders/${order.id}`,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    // Sanitize error message to prevent secret or credential exposure
    const rawMessage = error?.error?.description || error?.message || 'Razorpay order creation failed';
    const sanitizedMessage = sanitizePaymentErrorMessage(rawMessage);

    logger.error('Failed to create Razorpay payment order', {
      plan,
      amount_rupees: amountRupees,
      currency,
      error: sanitizedMessage,
    });

    throw new AppError(
      `Payment gateway error: ${sanitizedMessage}`,
      502,
      'PAYMENT_GATEWAY_ERROR'
    );
  }
}

/**
 * Generates an HMAC-SHA256 signature for a given payload using the Razorpay key secret.
 * Useful for tests and outgoing signature generation.
 */
export function generateRazorpaySignature(payload: string, secret?: string): string {
  if (typeof payload !== 'string') {
    throw new AppError('Payload must be a string for signature generation', 400, 'INVALID_PAYLOAD');
  }

  const keySecret = secret ?? env.RAZORPAY_KEY_SECRET;
  if (!keySecret || typeof keySecret !== 'string' || keySecret.trim() === '') {
    throw new AppError(
      'Razorpay key secret is not configured for signature generation',
      500,
      'PAYMENT_CONFIG_ERROR'
    );
  }

  return crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
}

/**
 * Verifies a Razorpay HMAC-SHA256 signature using constant-time comparison.
 * PRD Page 13: Verify payment signature.
 * 
 * - Accepts exact payload string (e.g. raw webhook body or `${orderId}|${paymentId}`)
 * - Compares computed HMAC-SHA256 against received signature using crypto.timingSafeEqual
 * - Safely rejects forged, mismatched, or malformed signatures without leaking secrets
 */
export function verifyRazorpaySignature(
  payload: string,
  signature: string,
  secret?: string
): boolean {
  if (
    !payload ||
    !signature ||
    typeof payload !== 'string' ||
    typeof signature !== 'string'
  ) {
    return false;
  }

  const keySecret = secret ?? env.RAZORPAY_KEY_SECRET;
  if (!keySecret || typeof keySecret !== 'string' || keySecret.trim() === '') {
    throw new AppError(
      'Razorpay key secret is not configured for signature verification',
      500,
      'PAYMENT_CONFIG_ERROR'
    );
  }

  try {
    const trimmedSig = signature.trim();

    // Verify signature format is valid hex (SHA-256 hex digest is 64 characters)
    if (!/^[0-9a-fA-F]{64}$/.test(trimmedSig)) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(payload)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const signatureBuf = Buffer.from(trimmedSig, 'hex');

    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}

/**
 * Verifies payment confirmation callback signature: `${orderId}|${paymentId}`
 */
export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret?: string
): boolean {
  if (!orderId || !paymentId || typeof orderId !== 'string' || typeof paymentId !== 'string') {
    return false;
  }
  return verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, secret);
}
