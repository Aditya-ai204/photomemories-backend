import { Router } from 'express';
import { createEventRequest } from '../controllers/eventController';
import {
  uploadEventPhotos,
  getEventPhotos,
  deletePhoto,
} from '../controllers/photoController';
import { requireAuth, requireRole } from '../middleware/auth';
import { uploadPhotosAndVideosMiddleware } from '../middleware/upload';

/**
 * Authoritative Event Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 12-13, 15-17)
 * Mounted at: /api/events
 */
const router = Router();

// POST /api/events/request
// Auth: Required (Photographer)
router.post('/request', requireAuth, requireRole('photographer'), createEventRequest);

// POST /api/events/:eventId/upload-photos
// Auth: Required (Photographer)
router.post(
  '/:eventId/upload-photos',
  requireAuth,
  requireRole('photographer'),
  uploadPhotosAndVideosMiddleware,
  uploadEventPhotos
);

// GET /api/events/:eventId/photos
// Auth: Required (Photographer)
router.get('/:eventId/photos', requireAuth, requireRole('photographer'), getEventPhotos);

// DELETE /api/events/:eventId/photos/:photoId (Sub-resource alias)
// Auth: Required (Photographer)
router.delete('/:eventId/photos/:photoId', requireAuth, requireRole('photographer'), deletePhoto);

export default router;

