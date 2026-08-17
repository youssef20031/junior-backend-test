import express, { type Express } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { env } from '../src/config/env';
import { authorize } from '../src/middleware/authorize';
import { errorHandler } from '../src/middleware/errorHandler';
import { Product } from '../src/models/Product';
import { HttpError } from '../src/utils/HttpError';
import { verifyAccessToken } from '../src/utils/jwt';

/**
 * These paths are hard to reach through the public API — the validators reject
 * bad input long before Mongoose or an unexpected exception can. A throwaway app
 * that hands a specific error straight to the middleware exercises them directly.
 */
function appThatFailsWith(error: unknown): Express {
  const app = express();
  app.get('/boom', (_req, _res, next) => {
    next(error);
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler — error translation', () => {
  it('passes an HttpError through untouched', async () => {
    const response = await request(appThatFailsWith(HttpError.forbidden('Nope')))
      .get('/boom')
      .expect(403);

    expect(response.body).toEqual({
      success: false,
      error: { message: 'Nope', code: 'FORBIDDEN' },
    });
  });

  it('includes details when the HttpError carries them', async () => {
    const error = HttpError.validation([{ field: 'name', message: 'name is required' }]);

    const response = await request(appThatFailsWith(error)).get('/boom').expect(400);

    expect(response.body.error.details).toEqual([
      { field: 'name', message: 'name is required' },
    ]);
  });

  it('turns a Mongoose ValidationError into a 400 listing every field', async () => {
    // A genuine ValidationError, produced by the real schema.
    const invalid = new Product({ name: '', price: -1, quantity: 1.5 });
    const validationError = await invalid.validate().then(
      () => null,
      (error: unknown) => error,
    );
    expect(validationError).toBeInstanceOf(mongoose.Error.ValidationError);

    const response = await request(appThatFailsWith(validationError)).get('/boom').expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const fields = (response.body.error.details as { field: string }[]).map((d) => d.field);
    expect(fields.sort()).toEqual(['name', 'price', 'quantity']);
  });

  it('turns a Mongoose CastError into a 400 rather than a 500', async () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'not-an-id', 'id');

    const response = await request(appThatFailsWith(castError)).get('/boom').expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'id', message: "'not-an-id' is not a valid ObjectId" },
    ]);
  });

  it('turns a duplicate-key error into a 409 naming the field', async () => {
    const duplicate = { code: 11000, keyValue: { email: 'taken@example.com' } };

    const response = await request(appThatFailsWith(duplicate)).get('/boom').expect(409);

    expect(response.body.error).toEqual({
      code: 'EMAIL_IN_USE',
      message: 'A record with this email already exists',
    });
  });

  it('falls back to a generic 409 message when the key is unknown', async () => {
    const response = await request(appThatFailsWith({ code: 11000 })).get('/boom').expect(409);

    expect(response.body.error.message).toBe('A record with this value already exists');
  });

  it('hides the details of an unexpected exception behind a 500', async () => {
    const leaky = new Error('Connection string: mongodb://root:hunter2@prod-db');

    const response = await request(appThatFailsWith(leaky)).get('/boom').expect(500);

    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('never leaks a stack trace, in any environment', async () => {
    const response = await request(appThatFailsWith(new Error('boom')))
      .get('/boom')
      .expect(500);

    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('handles a thrown value that is not an Error at all', async () => {
    const response = await request(appThatFailsWith('a bare string')).get('/boom').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('authorize — fails closed', () => {
  it('returns 401, not 403, when it runs without authenticate in front of it', async () => {
    const app = express();
    app.get('/guarded', authorize('admin'), (_req, res) => {
      res.json({ reached: true });
    });
    app.use(errorHandler);

    const response = await request(app).get('/guarded').expect(401);

    expect(response.body.error.code).toBe('TOKEN_MISSING');
  });

  it('accepts any one of several permitted roles', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'abc', role: 'user' };
      next();
    });
    app.get('/guarded', authorize('admin', 'user'), (_req, res) => {
      res.json({ reached: true });
    });
    app.use(errorHandler);

    await request(app).get('/guarded').expect(200);
  });
});

describe('verifyAccessToken — payload validation', () => {
  const sign = (payload: string | object): string =>
    jwt.sign(payload, env.jwt.secret, { algorithm: 'HS256' });

  it.each([
    ['a string payload instead of an object', sign('just-a-string')],
    ['no sub claim', sign({ role: 'admin' })],
    ['an empty sub claim', sign({ sub: '', role: 'admin' })],
    ['a non-string sub claim', sign({ sub: 12345, role: 'admin' })],
    ['no role claim', sign({ sub: 'abc123' })],
    ['a role that is not in the allow-list', sign({ sub: 'abc123', role: 'superuser' })],
    ['a role of the wrong type', sign({ sub: 'abc123', role: 7 })],
  ])('rejects a correctly signed token with %s', (_label, token) => {
    const result = verifyAccessToken(token);

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts a well-formed payload', () => {
    const result = verifyAccessToken(sign({ sub: 'abc123', role: 'admin' }));

    expect(result).toEqual({ ok: true, payload: { sub: 'abc123', role: 'admin' } });
  });
});
