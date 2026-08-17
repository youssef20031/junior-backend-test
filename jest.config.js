/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // Runs before any module is imported, so src/config/env.ts reads test values.
  setupFiles: ['<rootDir>/tests/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Spinning up the in-memory MongoDB the first time can be slow on a cold cache.
  testTimeout: 60000,
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/types/**',
    '!src/db/seed.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      lines: 80,
      branches: 70,
      functions: 80,
    },
  },
};
