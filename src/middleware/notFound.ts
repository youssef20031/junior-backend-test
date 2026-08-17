import { type RequestHandler } from 'express';
import { HttpError } from '../utils/HttpError';

/**
 * Catches anything no route matched, so unknown URLs get the same JSON error
 * envelope as everything else instead of Express's HTML default page.
 */
export const notFound: RequestHandler = (req, _res, next) => {
  next(
    HttpError.notFound(
      `Route ${req.method} ${req.originalUrl} not found`,
      'ROUTE_NOT_FOUND',
    ),
  );
};
