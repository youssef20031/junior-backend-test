import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { isUserRole, type UserRole } from '../types/roles';

/** The claims this API puts in — and expects to read back out of — an access token. */
export interface AccessTokenPayload {
  /** The user's MongoDB `_id`, in the standard `sub` claim. */
  sub: string;
  role: UserRole;
}

export type VerifyResult =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; reason: 'expired' | 'invalid' };

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    // The env value is validated as a non-empty string; jsonwebtoken's types
    // want its narrower `ms` template literal type.
    expiresIn: env.jwt.expiresIn as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.jwt.secret, options);
}

/**
 * Verifies a token without touching the database — the role travels in the
 * token itself, as the brief specifies.
 *
 * Returns a result object rather than throwing so that this module stays free
 * of HTTP concerns; `authenticate` maps the reason onto a status code.
 */
export function verifyAccessToken(token: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });

    if (typeof decoded !== 'object' || decoded === null) {
      return { ok: false, reason: 'invalid' };
    }

    const { sub, role } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || sub === '' || !isUserRole(role)) {
      return { ok: false, reason: 'invalid' };
    }

    return { ok: true, payload: { sub, role } };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
