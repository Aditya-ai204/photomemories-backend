import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env if present
dotenv.config();

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRY: z.string().default('24h'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  EMAIL_USER: z.string().min(1, 'EMAIL_USER is required'),
  EMAIL_PASSWORD: z.string().min(1, 'EMAIL_PASSWORD is required'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(customEnv?: Record<string, unknown>): Env {
  const source = customEnv || process.env;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${errorDetails}`);
  }
  return result.data;
}

// In test environment, fallback to test-safe placeholders if not supplied
const isTest = process.env['NODE_ENV'] === 'test';
export const env: Env = isTest
  ? {
      DATABASE_URL: process.env['DATABASE_URL'] || 'postgresql://test:test@localhost:5432/testdb',
      JWT_SECRET: process.env['JWT_SECRET'] || 'test_jwt_secret_at_least_32_characters_long',
      JWT_EXPIRY: process.env['JWT_EXPIRY'] || '24h',
      JWT_REFRESH_SECRET: process.env['JWT_REFRESH_SECRET'] || 'test_refresh_secret_at_least_32_characters_long',
      JWT_REFRESH_EXPIRY: process.env['JWT_REFRESH_EXPIRY'] || '7d',
      CLOUDINARY_CLOUD_NAME: process.env['CLOUDINARY_CLOUD_NAME'] || 'test_cloud',
      CLOUDINARY_API_KEY: process.env['CLOUDINARY_API_KEY'] || 'test_key',
      CLOUDINARY_API_SECRET: process.env['CLOUDINARY_API_SECRET'] || 'test_secret',
      EMAIL_USER: process.env['EMAIL_USER'] || 'test@example.com',
      EMAIL_PASSWORD: process.env['EMAIL_PASSWORD'] || 'test_password',
      ENCRYPTION_KEY:
        process.env['ENCRYPTION_KEY'] ||
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      RAZORPAY_KEY_ID: process.env['RAZORPAY_KEY_ID'] || 'rzp_test_key',
      RAZORPAY_KEY_SECRET: process.env['RAZORPAY_KEY_SECRET'] || 'rzp_test_secret',
      FRONTEND_URL: process.env['FRONTEND_URL'] || 'http://localhost:3000',
      ADMIN_EMAIL: process.env['ADMIN_EMAIL'] || 'admin@photomemories.ai',
      NODE_ENV: 'test',
      PORT: process.env['PORT'] ? Number(process.env['PORT']) : 3001,
    }
  : parseEnv();
