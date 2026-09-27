import { Router } from 'express';
import {
  signup,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

/**
 * Authoritative Authentication Routes
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 11-12)
 * Mounted at: /api/auth
 */
const router = Router();

// Public Authentication Endpoints
router.post('/signup', signup);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected Authentication Endpoints (PRD Page 12: "Request: {} (protected)")
router.post('/logout', requireAuth, logout);

export default router;
