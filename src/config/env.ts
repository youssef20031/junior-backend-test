import 'dotenv/config';
import { z } from 'zod';

/**
 * Used only outside production, and only when JWT_SECRET is unset, so that
 * `npm run dev` works with no configuration at all. Production refuses to boot
 * without a real secret — see the schema's `refine` below.
 */
const DEVELOPMENT_JWT_SECRET =
  'development-only-insecure-jwt-secret-do-not-use-in-production';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),

    /** Unset means "provision an in-memory MongoDB instead". */
    MONGODB_URI: z.string().trim().optional(),

    JWT_SECRET: z.string().trim().optional(),
    JWT_EXPIRES_IN: z.string().trim().min(1).default('1h'),

    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

    CORS_ORIGIN: z.string().trim().default('*'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    SEED_ADMIN_EMAIL: z.string().trim().toLowerCase().default('admin@example.com'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
    SEED_USER_EMAIL: z.string().trim().toLowerCase().default('user@example.com'),
    SEED_USER_PASSWORD: z.string().min(8).default('User@123'),
  })
  .refine(
    (value) => value.NODE_ENV !== 'production' || (value.JWT_SECRET?.length ?? 0) >= 32,
    {
      message:
        'JWT_SECRET is required when NODE_ENV=production and must be at least 32 characters',
      path: ['JWT_SECRET'],
    },
  );

/**
 * Blank environment variables (`MONGODB_URI=` in a .env file) arrive as empty
 * strings. Dropping them lets Zod apply its defaults, so "unset" and "set to
 * nothing" behave identically.
 */
function readEnvironment(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim() !== '',
  );
  return Object.fromEntries(entries);
}

const parsed = envSchema.safeParse(readEnvironment());

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const nodeEnv = raw.NODE_ENV;
const isTest = nodeEnv === 'test';

if (raw.JWT_SECRET === undefined && !isTest) {
  console.warn(
    '[config] JWT_SECRET is not set — falling back to an insecure development ' +
      'secret. Set JWT_SECRET before deploying anywhere real.',
  );
}

/** Parsed, validated, immutable configuration. The only place `process.env` is read. */
export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  isTest,
  port: raw.PORT,

  /** `undefined` means "start an in-memory MongoDB". */
  mongoUri: raw.MONGODB_URI,

  jwt: {
    secret: raw.JWT_SECRET ?? DEVELOPMENT_JWT_SECRET,
    expiresIn: raw.JWT_EXPIRES_IN,
  },

  bcryptRounds: raw.BCRYPT_ROUNDS,

  /** Either the literal `'*'` or an explicit allow-list of origins. */
  corsOrigin:
    raw.CORS_ORIGIN === '*'
      ? ('*' as const)
      : raw.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin !== ''),

  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX,
    authMax: raw.AUTH_RATE_LIMIT_MAX,
  },

  seed: {
    adminEmail: raw.SEED_ADMIN_EMAIL,
    adminPassword: raw.SEED_ADMIN_PASSWORD,
    userEmail: raw.SEED_USER_EMAIL,
    userPassword: raw.SEED_USER_PASSWORD,
  },
} as const;
