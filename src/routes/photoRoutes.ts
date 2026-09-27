import { Router } from 'express';
import { deletePhoto } from '../controllers/photoController';
import { requireAuth, requireRole } from '../middleware/auth';

/**
 * Authoritative Photo Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Page 17)
 * Mounted at: /api/photos
 */
const router = Router();

// DELETE /api/photos/:photoId
// Auth: Required (Photographer)
router.delete('/:photoId', requireAuth, requireRole('photographer'), deletePhoto);

export default router;
