import { type RequestHandler } from 'express';
import { HttpError } from '../utils/HttpError';
import { verifyAccessToken } from '../utils/jwt';

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the decoded
 * identity to `req.user`.
 *
 * The role is read from the token itself, as the brief specifies — no database
 * round-trip. The trade-off is that a role change only takes effect once the
 * old token expires (`JWT_EXPIRES_IN`, one hour by default).
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (header === undefined || header.trim() === '') {
    next(
      HttpError.unauthorized(
        'Authentication required — send an Authorization: Bearer <token> header',
        'TOKEN_MISSING',
      ),
    );
    return;
  }

  const token = BEARER_PATTERN.exec(header.trim())?.[1]?.trim();

  if (token === undefined || token === '') {
    next(
      HttpError.unauthorized(
        'Malformed Authorization header — expected "Bearer <token>"',
        'TOKEN_MISSING',
      ),
    );
    return;
  }

  const result = verifyAccessToken(token);

  if (!result.ok) {
    next(
      result.reason === 'expired'
        ? HttpError.unauthorized(
            'Access token has expired — log in again',
            'TOKEN_EXPIRED',
          )
        : HttpError.unauthorized('Access token is invalid', 'TOKEN_INVALID'),
    );
    return;
  }

  req.user = { id: result.payload.sub, role: result.payload.role };
  next();
};
