import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ApiErrorResponse } from '../types';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response): void {
  const errorResponse: ApiErrorResponse = {
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  };
  res.status(404).json(errorResponse);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected server error occurred';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  } else if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON payload in request body';
  } else if (err instanceof Error) {
    message = err.message;
  }

  // Sanitize stack trace in logs, never expose in public response
  logger.error(`[${req.method}] ${req.originalUrl} - ${code} (${statusCode}): ${message}`, {
    statusCode,
    code,
    error: err instanceof Error ? err.stack : err,
  });

  const response: ApiErrorResponse = {
    success: false,
    error: message,
    code,
  };

  res.status(statusCode).json(response);
}
