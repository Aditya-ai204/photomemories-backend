import { Router } from 'express';
import {
  getPhotographerEvents,
  getPhotographerEventById,
} from '../controllers/photographerController';
import { requireAuth, requireRole } from '../middleware/auth';

/**
 * Authoritative Photographer Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 14-15)
 * Mounted at: /api/photographer
 */
const router = Router();

// Protect all photographer endpoints with authentication and photographer role
router.use(requireAuth, requireRole('photographer'));

// GET /api/photographer/events
router.get('/events', getPhotographerEvents);

// GET /api/photographer/events/:eventId
router.get('/events/:eventId', getPhotographerEventById);

export default router;
