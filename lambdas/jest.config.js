module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'text', 'lcov'],
  coverageThreshold: { global: { statements: 90, branches: 80, functions: 90, lines: 90 } },
};
