import { Router } from 'express';
import {
  getPublicEventBySlug,
  getPublicPhotographerBySubdomain,
} from '../controllers/publicController';

/**
 * Authoritative Public Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 19-20, 26)
 * Mounted at: /api/public
 * 
 * Note: These endpoints are completely public and do NOT require JWT authentication.
 * Global security middleware (Helmet, CORS, rate limiting) remains active.
 */
const router = Router();

// GET /api/public/event/:slug
// Auth: Not required (Public)
router.get('/event/:slug', getPublicEventBySlug);

// GET /api/public/photographer/:subdomain
// Auth: Not required (Public)
router.get('/photographer/:subdomain', getPublicPhotographerBySubdomain);

export default router;
