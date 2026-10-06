module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
  restoreMocks: true,
  // Synthesising the whole stack takes a few seconds on a cold machine
  testTimeout: 60000,
};
