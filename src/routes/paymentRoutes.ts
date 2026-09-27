import { Router } from 'express';
import { handlePaymentWebhook } from '../controllers/paymentController';

/**
 * Payment Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 7-8, 13)
 * Base Path: /api/payments
 */
const router = Router();

/**
 * POST /api/payments/webhook
 * Public / Server-to-server Razorpay webhook endpoint.
 * Note: Does NOT use requireAuth because it is an asynchronous server-to-server callback.
 * Authentication is provided cryptographically via the x-razorpay-signature header.
 */
router.post('/webhook', handlePaymentWebhook);

export default router;
