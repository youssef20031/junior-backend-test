import request from 'supertest';
import { createApp } from '../src/app';
import { User } from '../src/models/User';
import { verifyAccessToken } from '../src/utils/jwt';
import { ADMIN_CREDENTIALS, createUser, USER_CREDENTIALS } from './helpers/auth';

const app = createApp();

/** Pulls the `details` entry for one field out of a validation error response. */
function detailFor(
  body: { error: { details?: { field: string; message: string }[] } },
  field: string,
) {
  return body.error.details?.find((detail) => detail.field === field);
}

describe('POST /auth/register', () => {
  it('creates an account and returns a usable token', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'new.user@example.com', password: 'Str0ngPass' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      email: 'new.user@example.com',
      role: 'user',
    });
    expect(response.body.data.expiresIn).toBe('1h');

    const verified = verifyAccessToken(response.body.data.accessToken);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toEqual({
        sub: response.body.data.user.id,
        role: 'user',
      });
    }
  });

  it('never includes the password in the response', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'quiet@example.com', password: 'Str0ngPass' })
      .expect(201);

    expect(response.body.data.user).not.toHaveProperty('password');
    expect(Object.keys(response.body.data.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'role',
      'updatedAt',
    ]);
  });

  it('stores the password as a bcrypt hash, not plaintext', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'hashed@example.com', password: 'Str0ngPass' })
      .expect(201);

    const stored = await User.findOne({ email: 'hashed@example.com' })
      .select('+password')
      .lean();

    expect(stored?.password).not.toBe('Str0ngPass');
    expect(stored?.password).toMatch(/^\$2[aby]\$/);
  });

  it('ignores a role supplied in the body — privilege escalation is impossible', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'sneaky@example.com', password: 'Str0ngPass', role: 'admin' })
      .expect(201);

    expect(response.body.data.user.role).toBe('user');

    const stored = await User.findOne({ email: 'sneaky@example.com' }).lean();
    expect(stored?.role).toBe('user');
  });

  it('lowercases and trims the email', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: '  MiXeD.Case@Example.COM  ', password: 'Str0ngPass' })
      .expect(201);

    expect(response.body.data.user.email).toBe('mixed.case@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser('user', { email: 'taken@example.com', password: 'Str0ngPass' });

    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'taken@example.com', password: 'Different1' })
      .expect(409);

    expect(response.body.error.code).toBe('EMAIL_IN_USE');
  });

  it.each([
    ['a missing email', { password: 'Str0ngPass' }, 'email', 'email is required'],
    [
      'a malformed email',
      { email: 'not-an-email', password: 'Str0ngPass' },
      'email',
      'email must be a valid email address',
    ],
    ['a missing password', { email: 'a@b.co' }, 'password', 'password is required'],
    [
      'a short password',
      { email: 'a@b.co', password: 'Sh0rt' },
      'password',
      'password must be between 8 and 128 characters',
    ],
    [
      'a password with no digit',
      { email: 'a@b.co', password: 'NoDigitsHere' },
      'password',
      'password must contain at least one number',
    ],
    [
      'a password with no letter',
      { email: 'a@b.co', password: '12345678' },
      'password',
      'password must contain at least one letter',
    ],
  ])(
    'rejects %s with a 400 naming the field',
    async (_label, payload, field, message) => {
      const response = await request(app)
        .post('/auth/register')
        .send(payload)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(detailFor(response.body, field)?.message).toBe(message);
    },
  );
});

describe('POST /auth/login', () => {
  it('returns a token carrying the account role', async () => {
    await createUser('admin');

    const response = await request(app)
      .post('/auth/login')
      .send(ADMIN_CREDENTIALS)
      .expect(200);

    expect(response.body.data.user).toMatchObject({
      email: ADMIN_CREDENTIALS.email,
      role: 'admin',
    });

    const verified = verifyAccessToken(response.body.data.accessToken);
    expect(verified.ok && verified.payload.role).toBe('admin');
  });

  it('matches the email case-insensitively', async () => {
    await createUser('user');

    await request(app)
      .post('/auth/login')
      .send({
        email: USER_CREDENTIALS.email.toUpperCase(),
        password: USER_CREDENTIALS.password,
      })
      .expect(200);
  });

  it('gives an unknown email and a wrong password the identical response', async () => {
    await createUser('user');

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: USER_CREDENTIALS.email, password: 'WrongPass1' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: USER_CREDENTIALS.password })
      .expect(401);

    // Any difference here would let an attacker enumerate registered accounts.
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
    expect(unknownEmail.body.error).toEqual(wrongPassword.body.error);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it.each([
    ['no body at all', {}],
    ['only an email', { email: USER_CREDENTIALS.email }],
    ['only a password', { password: USER_CREDENTIALS.password }],
  ])('rejects a request with %s', async (_label, payload) => {
    const response = await request(app).post('/auth/login').send(payload).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not apply the registration password policy to existing accounts', async () => {
    // A weak password predating the policy must still fail as *wrong*, not as
    // *invalid* — a 400 here would reveal that no such password could exist.
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'legacy@example.com', password: 'short' })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
