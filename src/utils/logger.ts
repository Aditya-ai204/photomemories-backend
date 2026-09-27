// Structured Logger with automatic sensitive data sanitization
// Never logs passwords, secrets, tokens, or encryption keys

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'jwt_secret',
  'jwt_refresh_secret',
  'encryption_key',
  'api_secret',
  'key_secret',
  'authorization',
  'cookie',
  'set-cookie',
]);

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitizedObj[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        sanitizedObj[key] = sanitize(value, depth + 1);
      } else {
        sanitizedObj[key] = value;
      }
    }
    return sanitizedObj;
  }

  return obj;
}

export const logger = {
  info: (message: string, meta?: unknown) => {
    if (process.env['NODE_ENV'] === 'test') return;
    const sanitizedMeta = meta ? sanitize(meta) : '';
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '');
  },
  warn: (message: string, meta?: unknown) => {
    const sanitizedMeta = meta ? sanitize(meta) : '';
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '');
  },
  error: (message: string, error?: unknown) => {
    const sanitizedError = error ? sanitize(error) : '';
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, sanitizedError);
  },
  debug: (message: string, meta?: unknown) => {
    if (process.env['NODE_ENV'] !== 'development') return;
    const sanitizedMeta = meta ? sanitize(meta) : '';
    console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '');
  },
};
