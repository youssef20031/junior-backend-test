import { type RequestHandler } from 'express';
import { HttpError } from '../utils/HttpError';
import { type UserRole } from '../types/roles';

/**
 * Role guard. Must run after `authenticate`, which is what puts `req.user` in
 * place; if it somehow runs first, this fails closed with a 401 rather than
 * letting the request through.
 *
 *   router.post('/', authenticate, authorize('admin'), ...)
 */
export function authorize(...allowedRoles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(HttpError.unauthorized('Authentication required', 'TOKEN_MISSING'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(
        HttpError.forbidden(
          `Insufficient permissions — this action requires the ${allowedRoles.join(
            ' or ',
          )} role`,
        ),
      );
      return;
    }

    next();
  };
}
