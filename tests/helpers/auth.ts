import { type Express } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { env } from '../../src/config/env';
import { User } from '../../src/models/User';
import { type UserRole } from '../../src/types/roles';
import { signAccessToken } from '../../src/utils/jwt';

export const ADMIN_CREDENTIALS = { email: 'admin@test.local', password: 'Admin@123' };
export const USER_CREDENTIALS = { email: 'user@test.local', password: 'User@1234' };

export const bearer = (token: string): string => `Bearer ${token}`;

/**
 * Mints a valid token without inserting a user. `authenticate` reads the role
 * straight from the token and never queries the database, so this is enough for
 * every authorization test — and much faster than a bcrypt round-trip.
 */
export function tokenFor(role: UserRole): string {
  return signAccessToken({ sub: new Types.ObjectId().toString(), role });
}

/** A structurally valid token that expired one second ago. */
export function expiredTokenFor(role: UserRole): string {
  return jwt.sign({ sub: new Types.ObjectId().toString(), role }, env.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: -1,
  });
}

/** A token signed with the wrong key — verification must reject it. */
export function foreignlySignedToken(role: UserRole): string {
  return jwt.sign({ sub: new Types.ObjectId().toString(), role }, 'not-the-real-secret', {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

/** Inserts a real user, hashing the password through the model's save hook. */
export async function createUser(
  role: UserRole,
  credentials = role === 'admin' ? ADMIN_CREDENTIALS : USER_CREDENTIALS,
): Promise<void> {
  await User.create({ ...credentials, role });
}

/**
 * The full end-to-end path: create an account, then obtain a token through the
 * real HTTP login endpoint rather than by signing one directly.
 */
export async function loginAs(app: Express, role: UserRole): Promise<string> {
  const credentials = role === 'admin' ? ADMIN_CREDENTIALS : USER_CREDENTIALS;
  await createUser(role, credentials);

  const response = await request(app).post('/auth/login').send(credentials).expect(200);
  return response.body.data.accessToken as string;
}
