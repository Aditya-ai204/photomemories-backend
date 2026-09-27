import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { helmetMiddleware, corsMiddleware, rateLimiter } from './middleware/security';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import eventRoutes from './routes/eventRoutes';
import photographerRoutes from './routes/photographerRoutes';
import paymentRoutes from './routes/paymentRoutes';
import adminRoutes from './routes/adminRoutes';
import photoRoutes from './routes/photoRoutes';
import publicRoutes from './routes/publicRoutes';

export function createApp(customRoutes?: (app: Express) => void): Express {
  const app = express();

  // Trust proxy for Railway/Render reverse proxies (for rate limiting and secure cookies)
  app.set('trust proxy', 1);

  // Security Headers
  app.use(helmetMiddleware);

  // CORS Bridge
  app.use(corsMiddleware);

  // Cookie Parser (for JWT tokens in httpOnly cookies)
  app.use(cookieParser());

  // Body Parsers with safe payload limits and raw body capture for webhook signature verification
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // General Rate Limiting (100 req / 15 min / IP)
  app.use(rateLimiter);

  /**
   * Operational Infrastructure Liveness Probe
   * Exclusively for container runtime/deployment monitoring (Railway/Render).
   * Note: This is an internal infrastructure endpoint, NOT a PhotoMemories product API.
   */
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Mount Product Authentication Routes (PRD Pages 11-12)
  app.use('/api/auth', authRoutes);

  // Mount Product Event Routes (PRD Pages 12-13)
  app.use('/api/events', eventRoutes);

  // Mount Product Photographer Routes (PRD Pages 14-15)
  app.use('/api/photographer', photographerRoutes);

  // Mount Product Payment Webhook Routes (PRD Page 13)
  app.use('/api/payments', paymentRoutes);

  // Mount Product Admin Routes (PRD Pages 17-19)
  app.use('/api/admin', adminRoutes);

  // Mount Product Photo Management Routes (PRD Page 17)
  app.use('/api/photos', photoRoutes);

  // Mount custom routes if supplied (e.g. For testing or future module routes)
  if (customRoutes) {
    customRoutes(app);
  }

  // 404 Catch-All Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
