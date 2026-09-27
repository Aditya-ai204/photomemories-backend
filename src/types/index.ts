// Common types for PhotoMemories AI Backend
// Authoritative Source: PhotoMemories_Backend_PRD_V2.pdf

import { DecodedAccessToken } from '../utils/jwt';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// Extend Express Request type with authenticated user payload and rawBody
declare global {
  namespace Express {
    interface Request {
      user?: DecodedAccessToken;
      rawBody?: string;
    }
  }
}
