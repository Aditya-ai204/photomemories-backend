import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../database';
import { AppError } from '../types';
import { encryptData } from '../utils/crypto';
import { generateUniqueEventSlug } from '../services/eventSlugService';
import {
  validatePlanAmount,
  createRazorpayOrder,
  isValidPlan,
  PlanType,
} from '../services/paymentService';
import { logger } from '../utils/logger';

/**
 * Validation schema for Photographer Event Request
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 12-13)
 * Endpoint: POST /api/events/request
 */
export const createEventRequestSchema = z.object({
  event_name: z.string().trim().min(1, 'event_name is required').max(255),
  couple_names: z.string().trim().min(1, 'couple_names is required').max(255),
  event_date: z
    .string()
    .trim()
    .min(1, 'event_date is required')
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'event_date must be a valid date (e.g. YYYY-MM-DD)',
    }),
  theme: z.string().trim().min(1, 'theme is required').max(50),
  location: z.string().trim().min(1, 'location is required').max(255),
  client_email: z.string().trim().email('client_email must be a valid email address').max(255),
  client_phone: z.string().trim().min(1, 'client_phone is required').max(50),
  plan: z
    .string()
    .trim()
    .transform((val) => val.toLowerCase())
    .refine((val): val is PlanType => isValidPlan(val), {
      message: 'plan must be one of: base, medium, pro',
    }),
  amount: z
    .number({ invalid_type_error: 'amount must be a number' })
    .positive('amount must be greater than 0'),
  description: z.string().trim().optional(),
});

export type CreateEventRequestInput = z.infer<typeof createEventRequestSchema>;

/**
 * POST /api/events/request
 * Auth: Required (Photographer)
 * Creates a new event request with status 'pending' and payment_status 'pending',
 * encrypts sensitive client contact data, generates a unique slug,
 * and creates a Razorpay payment order.
 * 
 * Response (201): { success: true, event_id: number, payment_url: string, plan: string }
 */
export async function createEventRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Authenticate photographer requester
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

    // 2. Validate request payload
    const validated = createEventRequestSchema.parse(req.body);

    // 3. Validate plan amount against configured plan pricing (ADR-002)
    validatePlanAmount(validated.plan, validated.amount);

    // 4. Encrypt sensitive client contact details at rest (PRD Pages 7, 23-24)
    const encryptedClientEmail = encryptData(validated.client_email);
    const encryptedClientPhone = encryptData(validated.client_phone);

    // 5. Generate unique event slug (PRD Pages 7-8, 12, 21)
    const uniqueSlug = await generateUniqueEventSlug(
      validated.couple_names,
      validated.event_name,
      validated.event_date
    );

    // 6. Create Razorpay payment intent / order
    const paymentOrder = await createRazorpayOrder({
      plan: validated.plan,
      amount: validated.amount,
      receipt: `rcpt_evt_${Date.now()}`,
      notes: {
        photographer_id: currentUser.userId,
        event_name: validated.event_name,
        slug: uniqueSlug,
      },
    });

    // 7. Insert event into events table with pending status
    const insertResult = await query<{ id: number }>(
      `INSERT INTO events (
        photographer_id,
        event_name,
        couple_names,
        event_date,
        theme,
        location,
        client_email,
        client_phone,
        plan,
        status,
        unique_slug,
        description,
        amount_paid,
        payment_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        currentUser.userId,
        validated.event_name,
        validated.couple_names,
        validated.event_date,
        validated.theme,
        validated.location,
        encryptedClientEmail,
        encryptedClientPhone,
        validated.plan,
        'pending',
        uniqueSlug,
        validated.description || null,
        validated.amount,
        'pending',
      ]
    );

    const eventId = insertResult.rows[0]?.id;
    if (!eventId) {
      throw new AppError('Failed to record event request in database', 500, 'DATABASE_ERROR');
    }

    // Safe logging without contact info or credentials
    logger.info('Photographer event request created successfully', {
      event_id: eventId,
      photographer_id: currentUser.userId,
      plan: validated.plan,
      slug: uniqueSlug,
      order_id: paymentOrder.order_id,
    });

    // 8. Return PRD-compliant 201 response (PRD Page 13)
    res.status(201).json({
      success: true,
      event_id: eventId,
      payment_url: paymentOrder.payment_url,
      plan: validated.plan,
    });
  } catch (error) {
    next(error);
  }
}
