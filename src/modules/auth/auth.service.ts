import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { serializeUser, User, type UserResponse } from '../../models/User';
import { HttpError } from '../../utils/HttpError';
import { signAccessToken } from '../../utils/jwt';

export interface Credentials {
  email: string;
  password: string;
}

export interface AuthResult {
  user: UserResponse;
  accessToken: string;
  expiresIn: string;
}

/**
 * A real bcrypt hash of a throwaway value. When no account matches an email we
 * still run one comparison against this, so "unknown email" and "wrong
 * password" cost the same wall-clock time and cannot be told apart.
 */
const TIMING_DECOY_HASH = bcrypt.hashSync('timing-attack-decoy', env.bcryptRounds);

function buildAuthResult(user: Parameters<typeof serializeUser>[0]): AuthResult {
  return {
    user: serializeUser(user),
    accessToken: signAccessToken({ sub: user._id.toString(), role: user.role }),
    expiresIn: env.jwt.expiresIn,
  };
}

/**
 * Creates an account. The role is hard-coded to `user` and never read from the
 * request, so this endpoint cannot be used to mint an administrator.
 */
export async function registerUser({
  email,
  password,
}: Credentials): Promise<AuthResult> {
  // Checked up front for a clear 409 message. The unique index on `email` is
  // what actually guarantees uniqueness under concurrency; a duplicate that
  // slips past this check surfaces as a Mongo 11000 error, which the central
  // error handler also turns into a 409.
  const existing = await User.exists({ email });
  if (existing !== null) {
    throw HttpError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  }

  const user = await User.create({ email, password, role: 'user' });
  return buildAuthResult(user);
}

export async function loginUser({ email, password }: Credentials): Promise<AuthResult> {
  const user = await User.findOne({ email }).select('+password');

  if (user === null) {
    await bcrypt.compare(password, TIMING_DECOY_HASH);
    throw HttpError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    // Identical message and code to the branch above: revealing which half of
    // the credentials was wrong would let an attacker enumerate accounts.
    throw HttpError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return buildAuthResult(user);
}
