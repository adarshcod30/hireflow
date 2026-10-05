// Two Jest projects in one config:
//   unit  fast tests of pure logic, adapters and guards, no database
//   e2e   the real Nest application over HTTP (Supertest) against real PostgreSQL
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [] } }] },
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
      setupFiles: ['<rootDir>/test/helpers/env.ts'],
    },
    {
      ...base,
      displayName: 'e2e',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/helpers/env.ts'],
      globalSetup: '<rootDir>/test/helpers/global-setup.ts',
      globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
      testTimeout: 30000,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/scripts/**',
    '!src/database/migrate.ts',
    '!src/database/data-source.ts',
    '!src/app.factory.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'text', 'lcov'],
  // Measured at 97.2 / 89.1 / 95.7 / 98.0. The gate sits just below, so a drop fails the build.
  coverageThreshold: { global: { statements: 93, branches: 84, functions: 91, lines: 94 } },
};
