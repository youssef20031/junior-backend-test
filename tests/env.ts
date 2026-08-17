/**
 * Runs before anything else is imported (jest `setupFiles`), so that
 * src/config/env.ts sees these values when it parses the environment.
 *
 * Every key is set explicitly — including MONGODB_URI, which is set to an empty
 * string rather than deleted. dotenv never overwrites a key that already
 * exists, so this guarantees a developer's local .env can't point the test
 * suite at a real database.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = '';
process.env.JWT_SECRET = 'test-suite-jwt-secret-long-enough-to-satisfy-production-checks';
process.env.JWT_EXPIRES_IN = '1h';

// The lowest cost bcryptjs accepts. Hashing is the slowest thing these tests do.
process.env.BCRYPT_ROUNDS = '4';

// Pinned so config assertions do not depend on the developer's local .env.
process.env.PORT = '3000';
process.env.CORS_ORIGIN = '*';
