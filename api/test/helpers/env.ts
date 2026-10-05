// Runs before each test file. Tests never read .env: every value the app needs
// is set here, so a developer's real settings cannot leak into a test.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256-signing';
process.env.INTERNAL_HMAC_SECRET = 'test-hmac-secret-that-is-long-enough-and-different';
process.env.STORAGE_DRIVER = 'local';
process.env.QUEUE_DRIVER = 'memory';
process.env.OUTBOX_RELAY_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_DEFAULT = '100000';
process.env.RATE_LIMIT_LOGIN = '100000';
process.env.RATE_LIMIT_APPLY = '100000';
process.env.BCRYPT_ROUNDS = '4';
