import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { app, createApp } from '../../src/app';
import { AppError } from '../../src/types';

describe('Express Application & Foundation Middleware Integration', () => {
  describe('Operational Health Endpoint', () => {
    it('GET /healthz returns 200 with status ok', async () => {
      const res = await request(app).get('/healthz');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('Security Headers (Helmet)', () => {
    it('applies X-Frame-Options: DENY and other security headers', async () => {
      const res = await request(app).get('/healthz');

      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers).toHaveProperty('content-security-policy');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('Standardized Error Format', () => {
    it('returns 404 with standardized error response for unknown routes', async () => {
      const res = await request(app).get('/api/non-existent-route');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'Route not found: GET /api/non-existent-route',
        code: 'NOT_FOUND',
      });
    });

    it('formats custom AppError correctly in error handling middleware', async () => {
      const testApp = createApp((router) => {
        router.get('/test-error', () => {
          throw new AppError('Unauthorized access to event', 403, 'FORBIDDEN');
        });
      });

      const res = await request(testApp).get('/test-error');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: 'Unauthorized access to event',
        code: 'FORBIDDEN',
      });
    });

    it('handles malformed JSON body with standardized 400 response', async () => {
      const res = await request(app)
        .post('/healthz') // Any endpoint
        .set('Content-Type', 'application/json')
        .send('{"invalid_json": ');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.code).toBe('INVALID_JSON');
    });
  });

  describe('CORS Configuration', () => {
    it('returns Access-Control-Allow-Origin for configured frontend origin', async () => {
      const res = await request(app)
        .get('/healthz')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows photographer wildcard subdomains on photomemories.ai', async () => {
      const res = await request(app)
        .get('/healthz')
        .set('Origin', 'https://john-photography.photomemories.ai');

      expect(res.headers['access-control-allow-origin']).toBe('https://john-photography.photomemories.ai');
    });
  });

  describe('Rate Limiting', () => {
    it('enforces 429 when rate limit threshold is exceeded', async () => {
      // Create a test app with strict 3-request rate limit
      const testRateLimitedApp = express();
      testRateLimitedApp.use(
        rateLimit({
          windowMs: 60 * 1000,
          max: 2,
          handler: (_req, res) => {
            res.status(429).json({
              success: false,
              error: 'Too many requests. Please try again in 15 minutes.',
              code: 'RATE_LIMIT_EXCEEDED',
            });
          },
        })
      );
      testRateLimitedApp.get('/test-limit', (_req, res) => res.json({ ok: true }));

      // First 2 requests succeed
      await request(testRateLimitedApp).get('/test-limit').expect(200);
      await request(testRateLimitedApp).get('/test-limit').expect(200);

      // 3rd request is rate limited
      const res = await request(testRateLimitedApp).get('/test-limit');
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        success: false,
        error: 'Too many requests. Please try again in 15 minutes.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    });
  });
});
