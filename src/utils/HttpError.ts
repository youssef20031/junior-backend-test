/**
 * Machine-readable error codes. Clients should branch on these rather than on
 * human-readable messages, which are free to change.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'MALFORMED_JSON'
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'EMAIL_IN_USE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/** One field-level problem, as surfaced in `error.details`. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * An error carrying everything the central error handler needs to render a
 * response. Throwing one of these from anywhere — controller, service, or
 * middleware — produces a consistent JSON body.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: FieldError[];

  constructor(statusCode: number, message: string, code: ErrorCode, details?: FieldError[]) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, HttpError);
  }

  static badRequest(message: string, code: ErrorCode = 'VALIDATION_ERROR'): HttpError {
    return new HttpError(400, message, code);
  }

  static validation(details: FieldError[]): HttpError {
    return new HttpError(400, 'Request validation failed', 'VALIDATION_ERROR', details);
  }

  static unauthorized(message: string, code: ErrorCode = 'TOKEN_INVALID'): HttpError {
    return new HttpError(401, message, code);
  }

  static forbidden(message: string): HttpError {
    return new HttpError(403, message, 'FORBIDDEN');
  }

  static notFound(message: string, code: ErrorCode = 'NOT_FOUND'): HttpError {
    return new HttpError(404, message, code);
  }

  static conflict(message: string, code: ErrorCode): HttpError {
    return new HttpError(409, message, code);
  }

  static tooManyRequests(message: string): HttpError {
    return new HttpError(429, message, 'RATE_LIMITED');
  }

  static internal(message = 'An unexpected error occurred'): HttpError {
    return new HttpError(500, message, 'INTERNAL_ERROR');
  }
}
