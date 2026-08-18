/* eslint-disable @typescript-eslint/no-require-imports */
import { type env as EnvShape } from '../src/config/env';

/**
 * Configuration is load-bearing: a bad value must stop the process rather than
 * produce a subtly misconfigured server. Each case re-imports the module in
 * isolation so it re-parses a modified environment.
 */
function loadEnv(overrides: Record<string, string>): typeof EnvShape {
  const saved = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    let loaded: typeof EnvShape | undefined;
    jest.isolateModules(() => {
      loaded = (require('../src/config/env') as { env: typeof EnvShape }).env;
    });
    return loaded as typeof EnvShape;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('environment parsing', () => {
  it('applies defaults when optional values are blank', () => {
    const env = loadEnv({ JWT_EXPIRES_IN: '', BCRYPT_ROUNDS: '' });

    expect(env.jwt.expiresIn).toBe('1h');
    expect(env.bcryptRounds).toBe(10);
  });

  it('treats a blank MONGODB_URI as "provision an in-memory database"', () => {
    const env = loadEnv({ MONGODB_URI: '   ' });

    expect(env.mongoUri).toBeUndefined();
  });

  it('coerces numeric values out of their string form', () => {
    const env = loadEnv({ PORT: '8080', BCRYPT_ROUNDS: '12' });

    expect(env.port).toBe(8080);
    expect(env.bcryptRounds).toBe(12);
  });

  it('keeps CORS_ORIGIN=* as a wildcard', () => {
    expect(loadEnv({ CORS_ORIGIN: '*' }).corsOrigin).toBe('*');
  });

  it('splits a comma-separated CORS_ORIGIN into an allow-list', () => {
    const env = loadEnv({ CORS_ORIGIN: 'https://a.example , https://b.example ,' });

    expect(env.corsOrigin).toEqual(['https://a.example', 'https://b.example']);
  });

  it('derives the environment flags from NODE_ENV', () => {
    const env = loadEnv({ NODE_ENV: 'development' });

    expect(env.isDevelopment).toBe(true);
    expect(env.isProduction).toBe(false);
    expect(env.isTest).toBe(false);
  });

  it.each([
    ['a non-numeric PORT', { PORT: 'not-a-port' }],
    ['a PORT above the valid range', { PORT: '70000' }],
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }],
    ['a bcrypt cost that is too low to be safe', { BCRYPT_ROUNDS: '1' }],
    ['a seed password shorter than the policy allows', { SEED_ADMIN_PASSWORD: 'short' }],
  ])('refuses to start with %s', (_label, overrides) => {
    expect(() => loadEnv(overrides)).toThrow(/Invalid environment configuration/);
  });

  it('names the offending variable in the failure message', () => {
    expect(() => loadEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  describe('production hardening', () => {
    it('refuses to start without a JWT_SECRET', () => {
      expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow(
        /JWT_SECRET is required when NODE_ENV=production/,
      );
    });

    it('refuses a JWT_SECRET that is too short to be meaningful', () => {
      expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'tooshort' })).toThrow(
        /at least 32 characters/,
      );
    });

    it('starts with a sufficiently long JWT_SECRET', () => {
      const secret = 'x'.repeat(48);
      const env = loadEnv({ NODE_ENV: 'production', JWT_SECRET: secret });

      expect(env.isProduction).toBe(true);
      expect(env.jwt.secret).toBe(secret);
    });
  });

  describe('development fallback', () => {
    it('warns loudly and falls back when JWT_SECRET is unset outside production', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const env = loadEnv({ NODE_ENV: 'development', JWT_SECRET: '' });

        expect(env.jwt.secret).toContain('development-only-insecure');
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('JWT_SECRET is not set'),
        );
      } finally {
        warn.mockRestore();
      }
    });
  });
});
