import { type ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { HttpError, type FieldError } from '../utils/HttpError';

/** Mongo's duplicate-key error is not a Mongoose error class, so it needs a shape check. */
function isDuplicateKeyError(
  error: unknown,
): error is { code: number; keyValue?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}

/** `express.json()` rejects unparseable bodies with a tagged SyntaxError. */
function isMalformedJsonError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status: unknown }).status === 400 &&
    'body' in error
  );
}

/**
 * Funnels every kind of failure into a single `HttpError` so the response shape
 * never depends on which layer threw.
 */
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (isMalformedJsonError(error)) {
    return HttpError.badRequest('Request body is not valid JSON', 'MALFORMED_JSON');
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const details: FieldError[] = Object.values(error.errors).map((fieldError) => ({
      field: fieldError.path,
      message: fieldError.message,
    }));
    return HttpError.validation(details);
  }

  if (error instanceof mongoose.Error.CastError) {
    return HttpError.validation([
      {
        field: error.path,
        message: `'${String(error.value)}' is not a valid ${error.kind}`,
      },
    ]);
  }

  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyValue ?? {})[0] ?? 'value';
    return HttpError.conflict(
      `A record with this ${field} already exists`,
      'EMAIL_IN_USE',
    );
  }

  return HttpError.internal();
}

/**
 * The last middleware in the stack. Must keep all four parameters for Express to
 * recognise it as an error handler.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const httpError = toHttpError(error);

  // Anything we did not deliberately throw is a bug — surface it in the logs
  // (but never in the response, which would leak internals).
  if (httpError.statusCode >= 500 && !env.isTest) {
    console.error('[error]', error);
  }

  // Stack traces stay out of the body in every environment, not just
  // production. Beyond the obvious disclosure risk, including one would make
  // otherwise-identical responses distinguishable — which is precisely how the
  // two "Invalid email or password" branches would leak whether an account
  // exists. Use the logs for debugging instead.
  res.status(httpError.statusCode).json({
    success: false,
    error: {
      message: httpError.message,
      code: httpError.code,
      ...(httpError.details ? { details: httpError.details } : {}),
    },
  });
};
