import { Router } from 'express';
import {
  getPendingEvents,
  getAllAdminEvents,
  markEventReady,
} from '../controllers/adminController';
import { requireAuth, requireRole } from '../middleware/auth';

/**
 * Authoritative Admin Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 17-19)
 * Mounted at: /api/admin
 */
const router = Router();

// Enforce admin-only authentication and authorization across all admin routes
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/events/pending
router.get('/events/pending', getPendingEvents);

// GET /api/admin/events
router.get('/events', getAllAdminEvents);

// POST /api/admin/events/:eventId/mark-ready
router.post('/events/:eventId/mark-ready', markEventReady);

export default router;

