import { Request, Response, NextFunction } from 'express';
import { query } from '../database';
import { env } from '../config/env';
import { verifyRazorpaySignature } from '../services/paymentService';
import {
  sendPhotographerPaymentConfirmationEmail,
  sendAdminPaymentNotificationEmail,
} from '../services/emailService';
import { logger } from '../utils/logger';

/**
 * Controller for Payment Webhook Integration
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 7-8, 13)
 * Endpoint: POST /api/payments/webhook
 * 
 * Rules:
 * 1. Webhook callbacks from Razorpay/Stripe do NOT use user JWT authentication.
 * 2. HMAC-SHA256 signature verification over the exact raw body is mandatory.
 * 3. Idempotent: repeated callbacks for already completed events return 200 without duplicate emails or state mutations.
 * 4. On successful verification:
 *    - Update events: payment_status = 'completed'
 *    - Send email to photographer: "Admin will create your pages"
 *    - Send email to admin (Krish): "New request from photographer X"
 * 5. Email failures are non-blocking and do not roll back the successful payment status update.
 */
export async function handlePaymentWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Extract signature from headers
    const rawHeader = req.headers['x-razorpay-signature'];
    const signature = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!signature || typeof signature !== 'string' || signature.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'Missing webhook signature header',
        code: 'MISSING_SIGNATURE',
      });
      return;
    }

    // 2. Resolve raw body string for cryptographic HMAC verification
    let rawPayload = req.rawBody;
    if (typeof rawPayload !== 'string') {
      if (typeof req.body === 'string') {
        rawPayload = req.body;
      } else if (req.body && typeof req.body === 'object') {
        rawPayload = JSON.stringify(req.body);
      } else {
        rawPayload = '';
      }
    }

    // 3. Verify cryptographic HMAC-SHA256 signature
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'] || env.RAZORPAY_KEY_SECRET;
    const isSignatureValid = verifyRazorpaySignature(rawPayload, signature, webhookSecret);

    if (!isSignatureValid) {
      logger.warn('Rejected payment webhook: invalid signature');
      res.status(400).json({
        success: false,
        error: 'Invalid webhook signature',
        code: 'INVALID_SIGNATURE',
      });
      return;
    }

    // 4. Safely parse body
    let body: any = req.body;
    if (typeof body !== 'object' || body === null) {
      try {
        body = JSON.parse(rawPayload);
      } catch {
        res.status(400).json({
          success: false,
          error: 'Malformed JSON payload in webhook body',
          code: 'INVALID_JSON',
        });
        return;
      }
    }

    // 5. Extract event identifiers from Razorpay webhook structure or custom test payload
    const notes =
      body.payload?.payment?.entity?.notes ||
      body.payload?.order?.entity?.notes ||
      body.notes ||
      {};

    const slugCandidate =
      notes.slug ||
      notes.event_slug ||
      body.slug ||
      body.event_slug ||
      null;

    const rawEventId =
      notes.event_id ||
      body.event_id ||
      body.payload?.payment?.entity?.notes?.event_id ||
      body.payload?.order?.entity?.notes?.event_id ||
      null;

    const eventIdCandidate =
      rawEventId !== null && rawEventId !== undefined && !isNaN(Number(rawEventId))
        ? Number(rawEventId)
        : null;

    if (!slugCandidate && eventIdCandidate === null) {
      res.status(400).json({
        success: false,
        error: 'Missing event reference (slug or event_id) in webhook payload',
        code: 'MISSING_EVENT_REFERENCE',
      });
      return;
    }

    // 6. Extract paid amount if present
    const paymentEntity = body.payload?.payment?.entity;
    const orderEntity = body.payload?.order?.entity;
    const rawAmount = paymentEntity?.amount ?? orderEntity?.amount ?? body.amount;
    let paidAmountRupees: number | null = null;

    if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount > 0) {
      // Razorpay amounts are delivered in smallest unit (paise: 1 INR = 100 paise)
      paidAmountRupees = rawAmount >= 100 ? Math.round(rawAmount / 100) : rawAmount;
    }

    // 7. Query event and photographer information
    let eventResult;
    if (eventIdCandidate !== null && slugCandidate) {
      eventResult = await query<{
        id: number;
        event_name: string;
        unique_slug: string;
        plan: string;
        amount_paid: number | string | null;
        payment_status: string;
        photographer_id: number;
        photographer_name: string | null;
        photographer_email: string;
      }>(
        `SELECT 
          e.id, 
          e.event_name, 
          e.unique_slug, 
          e.plan, 
          e.amount_paid, 
          e.payment_status, 
          e.photographer_id,
          u.name AS photographer_name, 
          u.email AS photographer_email
        FROM events e
        JOIN users u ON e.photographer_id = u.id
        WHERE e.id = $1 OR e.unique_slug = $2
        LIMIT 1`,
        [eventIdCandidate, String(slugCandidate)]
      );
    } else if (eventIdCandidate !== null) {
      eventResult = await query<{
        id: number;
        event_name: string;
        unique_slug: string;
        plan: string;
        amount_paid: number | string | null;
        payment_status: string;
        photographer_id: number;
        photographer_name: string | null;
        photographer_email: string;
      }>(
        `SELECT 
          e.id, 
          e.event_name, 
          e.unique_slug, 
          e.plan, 
          e.amount_paid, 
          e.payment_status, 
          e.photographer_id,
          u.name AS photographer_name, 
          u.email AS photographer_email
        FROM events e
        JOIN users u ON e.photographer_id = u.id
        WHERE e.id = $1
        LIMIT 1`,
        [eventIdCandidate]
      );
    } else {
      eventResult = await query<{
        id: number;
        event_name: string;
        unique_slug: string;
        plan: string;
        amount_paid: number | string | null;
        payment_status: string;
        photographer_id: number;
        photographer_name: string | null;
        photographer_email: string;
      }>(
        `SELECT 
          e.id, 
          e.event_name, 
          e.unique_slug, 
          e.plan, 
          e.amount_paid, 
          e.payment_status, 
          e.photographer_id,
          u.name AS photographer_name, 
          u.email AS photographer_email
        FROM events e
        JOIN users u ON e.photographer_id = u.id
        WHERE e.unique_slug = $1
        LIMIT 1`,
        [String(slugCandidate)]
      );
    }

    const event = eventResult.rows[0];
    if (!event) {
      logger.warn('Payment webhook received for non-existent event', {
        event_id: eventIdCandidate,
        slug: slugCandidate,
      });
      res.status(404).json({
        success: false,
        error: 'Event not found for webhook notification',
        code: 'EVENT_NOT_FOUND',
      });
      return;
    }

    // 8. Idempotency Check: if payment is already completed, return 200 without duplicate actions
    if (event.payment_status === 'completed') {
      logger.info('Duplicate payment webhook ignored for already completed event', {
        event_id: event.id,
        slug: event.unique_slug,
      });
      res.status(200).json({
        success: true,
        message: 'Payment already completed',
        already_processed: true,
        event_id: event.id,
      });
      return;
    }

    // 9. Update event payment_status in database
    const finalAmount = paidAmountRupees !== null ? paidAmountRupees : event.amount_paid;
    await query(
      `UPDATE events
       SET payment_status = 'completed',
           amount_paid = COALESCE($1, amount_paid)
       WHERE id = $2`,
      [finalAmount, event.id]
    );

    // 10. Non-blocking email dispatch: photographer confirmation & admin notification
    // Email to photographer: "Admin will create your pages" (PRD Page 13)
    if (event.photographer_email) {
      sendPhotographerPaymentConfirmationEmail(
        event.photographer_email,
        event.photographer_name || undefined,
        event.event_name
      ).catch((err) => {
        logger.error('Failed to send photographer payment confirmation email', {
          event_id: event.id,
          error: (err as Error).message,
        });
      });
    }

    // Email to admin (Krish): "New request from photographer X" (PRD Page 13)
    sendAdminPaymentNotificationEmail(
      env.ADMIN_EMAIL,
      event.photographer_name || 'Photographer',
      event.photographer_email,
      event.event_name,
      event.id,
      event.plan || 'base',
      Number(finalAmount || 0)
    ).catch((err) => {
      logger.error('Failed to send admin payment notification email', {
        event_id: event.id,
        error: (err as Error).message,
      });
    });

    logger.info('Payment webhook successfully processed and event updated to completed', {
      event_id: event.id,
      slug: event.unique_slug,
      payment_status: 'completed',
    });

    // 11. Return PRD-compliant success response
    res.status(200).json({
      success: true,
      message: 'Payment verified and event updated successfully',
      event_id: event.id,
      payment_status: 'completed',
    });
  } catch (error) {
    next(error);
  }
}
