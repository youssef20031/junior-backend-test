import { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { HttpError } from '../utils/HttpError';

/** Limiting is disabled under NODE_ENV=test so the suite cannot throttle itself. */
const passthrough: RequestHandler = (_req, _res, next) => next();

const rejectWith429: RequestHandler = (_req, _res, next) => {
  next(
    HttpError.tooManyRequests('Too many requests — please slow down and try again later'),
  );
};

/** Broad protection against a single client hammering the whole API. */
export const globalLimiter: RequestHandler = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: env.rateLimit.windowMs,
      limit: env.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rejectWith429,
    });

/**
 * A much tighter budget for the credential endpoints, to blunt password
 * guessing. Successful requests are not counted, so a legitimate user logging
 * in repeatedly is never locked out.
 */
export const authLimiter: RequestHandler = env.isTest
  ? passthrough
  : rateLimit({
      windowMs: env.rateLimit.windowMs,
      limit: env.rateLimit.authMax,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rejectWith429,
    });
